import type { CompletionDebugInfo, Settings } from '~/types'
import {
  buildOpenAICompatibleHeaders,
  joinOpenAICompatibleUrl,
} from '~/utils/providers/openai-compatible'
import { buildCompletionUserPrompt } from './prompt'

export const COMPLETION_SKIP_SENTINEL = '__COPYCAT_SKIP__'

/**
 * Arguments for a single inline completion request.
 *
 * Use when:
 * - building a completion request from an editor surface
 * - passing prompt fragments and settings into the LLM utility
 *
 * Expects:
 * - `prefix` to contain the text before the cursor
 * - `suffix` and `context` to be omitted when unavailable
 *
 * Returns:
 * - a typed request shape consumed by `completeOnce` and `completeOnceDetailed`
 */
export interface CompleteArgs {
  prefix: string
  suffix?: string
  context?: string
  soulContext?: string
  settings: Settings
  signal?: AbortSignal
}

/**
 * Detailed completion result returned by the LLM utility.
 *
 * Use when:
 * - the caller needs both the final completion and debug metadata
 *
 * Expects:
 * - `completion` to match the model output returned for the current request
 *
 * Returns:
 * - the final text plus request/response debug details
 */
export interface CompleteResult {
  completion: string
  skipped: boolean
  debug: CompletionDebugInfo
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

interface ChatChoice {
  message?: {
    content?: string
  }
  delta?: {
    content?: string
  }
}

interface ChatCompletionBody {
  model: string
  messages: ChatMessage[]
  temperature: number
  max_tokens: number
  stream: false
}

/**
 * Requests a single inline completion string.
 *
 * Use when:
 * - the caller only needs the final continuation text
 * - debug metadata is unnecessary for the current surface
 *
 * Expects:
 * - `args.settings` to contain a usable base URL, model, and prompt settings
 *
 * Returns:
 * - the continuation text returned by the model
 */
export async function completeOnce(args: CompleteArgs): Promise<string> {
  const result = await completeOnceDetailed(args)
  return result.completion
}

/**
 * Requests a single inline completion and returns debug metadata alongside it.
 *
 * Use when:
 * - a surface such as the playground needs to inspect prompt and raw model output
 * - the caller wants the returned completion plus request diagnostics
 *
 * Expects:
 * - `prefix` to represent the text before the cursor
 * - `settings` to point at an OpenAI-compatible chat completions endpoint
 *
 * Returns:
 * - the returned completion and structured debug information for the request
 */
export async function completeOnceDetailed({
  prefix,
  suffix,
  context,
  soulContext,
  settings,
  signal,
}: CompleteArgs): Promise<CompleteResult> {
  const url = joinOpenAICompatibleUrl(settings.baseUrl, '/chat/completions')
  const userPrompt = buildCompletionUserPrompt({
    prefix,
    suffix,
    context,
    soulContext,
  })
  const body = buildChatCompletionBody({
    model: settings.model,
    systemPrompt: settings.systemPrompt,
    userPrompt,
    temperature: settings.temperature,
    maxTokens: settings.maxTokens,
  })

  const res = await fetch(url, {
    method: 'POST',
    headers: buildOpenAICompatibleHeaders(settings.apiKey),
    body: JSON.stringify(body),
    signal,
  })

  if (!res.ok) {
    const text = await safeReadText(res)
    throw new Error(`LLM HTTP ${res.status}: ${truncate(text, 200)}`)
  }

  const json = (await res.json()) as { choices?: ChatChoice[] }
  const choice = json.choices?.[0]
  const rawCompletion = extractRawCompletion(choice)
  const normalized = normalizeCompletion(rawCompletion)

  return {
    completion: normalized.completion,
    skipped: normalized.skipped,
    debug: {
      rawCompletion,
      sanitizedCompletion: normalized.completion,
      skipReason: normalized.skipReason,
      rawChoice: safeStringify(choice ?? null),
      cacheHit: false,
      requestBody: {
        systemPrompt: settings.systemPrompt,
        userPrompt,
      },
    },
  }
}

function buildChatCompletionBody(args: {
  model: string
  systemPrompt: string
  userPrompt: string
  temperature: number
  maxTokens: number
}): ChatCompletionBody {
  return {
    model: args.model,
    messages: [
      { role: 'system', content: args.systemPrompt },
      { role: 'user', content: args.userPrompt },
    ],
    temperature: args.temperature,
    max_tokens: args.maxTokens,
    stream: false,
  }
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  }
  catch {
    return String(value)
  }
}

async function safeReadText(res: Response): Promise<string> {
  try {
    return await res.text()
  }
  catch {
    return ''
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s
}

/**
 * Extracts the assistant completion text from the first chat choice shape we support.
 *
 * Use when:
 * - consuming chat-completions style responses with either `message.content` or `delta.content`
 *
 * Expects:
 * - `choice` to be the parsed first response choice when present
 *
 * Returns:
 * - the raw completion text
 */
export function extractRawCompletion(choice?: ChatChoice): string {
  return choice?.message?.content ?? choice?.delta?.content ?? ''
}

export function normalizeCompletion(rawCompletion: string): {
  completion: string
  skipped: boolean
  skipReason?: CompletionDebugInfo['skipReason']
} {
  const trimmedCompletion = rawCompletion.trim()

  if (trimmedCompletion === COMPLETION_SKIP_SENTINEL) {
    return {
      completion: '',
      skipped: true,
      skipReason: 'sentinel',
    }
  }

  if (trimmedCompletion.length === 0) {
    return {
      completion: '',
      skipped: true,
      skipReason: rawCompletion.length === 0 ? 'empty' : 'whitespace',
    }
  }

  return {
    completion: rawCompletion,
    skipped: false,
  }
}
