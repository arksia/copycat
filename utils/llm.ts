import type { CompletionDebugInfo, Settings } from '~/types'
import {
  buildOpenAICompatibleHeaders,
  joinOpenAICompatibleUrl,
} from './openai-compatible'

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
 * - `completion` to already be sanitized for inline use
 *
 * Returns:
 * - the final text plus request/response debug details
 */
export interface CompleteResult {
  completion: string
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
 * Requests a single sanitized inline completion string.
 *
 * Use when:
 * - the caller only needs the final continuation text
 * - debug metadata is unnecessary for the current surface
 *
 * Expects:
 * - `args.settings` to contain a usable base URL, model, and prompt settings
 *
 * Returns:
 * - the sanitized continuation text ready for inline insertion
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
 * - the caller wants the sanitized completion plus request diagnostics
 *
 * Expects:
 * - `prefix` to represent the text before the cursor
 * - `settings` to point at an OpenAI-compatible chat completions endpoint
 *
 * Returns:
 * - the sanitized completion and structured debug information for the request
 */
export async function completeOnceDetailed({
  prefix,
  suffix,
  context,
  settings,
  signal,
}: CompleteArgs): Promise<CompleteResult> {
  const url = joinOpenAICompatibleUrl(settings.baseUrl, '/chat/completions')
  const userPrompt = buildUserPrompt({ prefix, suffix, context })
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
  const completion = sanitizeCompletion(rawCompletion, prefix)

  return {
    completion,
    debug: {
      rawCompletion,
      sanitizedCompletion: completion,
      rawChoice: safeStringify(choice ?? null),
      cacheHit: false,
      requestBody: {
        systemPrompt: settings.systemPrompt,
        userPrompt,
      },
    },
  }
}

function buildUserPrompt(args: {
  prefix: string
  suffix?: string
  context?: string
}): string {
  const userParts: string[] = []
  if (args.context !== undefined && args.context.trim().length > 0) {
    userParts.push(`[Knowledge]\n${args.context.trim()}`)
  }
  userParts.push(
    `[Prefix]\n${args.prefix}\n\n[Task]\nContinue the prefix with a short, natural continuation. `
    + `Output ONLY the continuation text, without repeating the prefix.`,
  )
  if (args.suffix !== undefined && args.suffix.trim().length > 0) {
    userParts.push(`[Suffix after cursor]\n${args.suffix}`)
  }
  return userParts.join('\n\n')
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
 * - the raw completion text before sanitization
 */
export function extractRawCompletion(choice?: ChatChoice): string {
  return choice?.message?.content ?? choice?.delta?.content ?? ''
}

/**
 * Normalizes model output into an inline continuation.
 *
 * Before:
 * - `"我需要构建一个博客系统，该如何开始？"`, prefix = `"我需要构建一个博客系统"`
 *
 * After:
 * - `"，该如何开始？"`
 */
export function sanitizeCompletion(raw: string, prefix: string): string {
  if (!raw)
    return ''
  let out = raw.replace(/\r/g, '')

  out = out.replace(/^```[\s\S]*?\n/, '').replace(/\n```$/, '')
  out = out.replace(/^\s*["'“”‘’「」『』]+/, '').replace(/["'“”‘’「」『』]+\s*$/, '')

  const trimmedPrefix = prefix.trimEnd()
  if (trimmedPrefix && out.startsWith(trimmedPrefix)) {
    out = out.slice(trimmedPrefix.length)
  }

  if (/\s$/.test(prefix)) {
    out = out.replace(/^\s+/, '')
  }

  const lines = out.split('\n')
  if (lines.length > 2) {
    out = lines.slice(0, 2).join('\n')
  }

  return out.replace(/\s+$/u, '')
}
