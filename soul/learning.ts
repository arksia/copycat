import type { CompletionEvent, Settings } from '~/types'
import { buildChatCompletionBody } from '~/utils/completion/client'
import {
  buildOpenAICompatibleHeaders,
  extractAssistantMessageContent,
  joinOpenAICompatibleUrl,
} from '~/utils/providers/openai-compatible'

const SOUL_LEARNING_MIN_EVENTS = 6
const SOUL_LEARNING_MIN_ACTIONABLE_EVENTS = 3
const SOUL_LEARNING_MAX_EVENTS = 20
const SOUL_LEARNING_MAX_TEXT_CHARS = 1600

const SOUL_LEARNING_SYSTEM_PROMPT = `You update Copycat's Soul text from local autocomplete behavior.
Return JSON only.
The Soul is a concise durable writing profile for future inline autocomplete.
Do not invent facts.
Only make conservative edits supported by repeated accepted or rejected behavior.
Preserve user-written constraints unless evidence strongly suggests a small wording improvement.`

export interface SoulLearningDecisionInput {
  events: CompletionEvent[]
  lastRunAt: number
  now: number
  cooldownMs: number
}

export interface SoulLearningResponse {
  shouldUpdate: boolean
  nextSoulText: string
  reason: string
}

export interface RunSoulLearningArgs {
  currentSoulText: string
  events: CompletionEvent[]
  settings: Settings
  signal?: AbortSignal
}

/**
 * Decides whether the background has enough fresh behavior to ask the model for a Soul update.
 */
export function shouldRunSoulLearning(input: SoulLearningDecisionInput): boolean {
  if (input.now - input.lastRunAt < input.cooldownMs) {
    return false
  }

  if (input.events.length < SOUL_LEARNING_MIN_EVENTS) {
    return false
  }

  const actionableCount = input.events
    .filter(event => event.action === 'accepted' || event.action === 'rejected')
    .length

  return actionableCount >= SOUL_LEARNING_MIN_ACTIONABLE_EVENTS
}

/**
 * Builds the user prompt for low-frequency model-driven Soul distillation.
 */
export function buildSoulLearningPrompt(args: {
  currentSoulText: string
  events: CompletionEvent[]
}): string {
  const events = args.events
    .slice(0, SOUL_LEARNING_MAX_EVENTS)
    .map(formatSoulLearningEvent)
    .join('\n')
  const currentSoulText = args.currentSoulText.trim() || '(empty)'

  return [
    '[Current Soul Text]',
    currentSoulText,
    '',
    '[Recent Autocomplete Events]',
    events || '(none)',
    '',
    '[Task]',
    'Decide whether the Soul text should be updated.',
    'Focus on stable writing preferences, avoided styles, recurring structure choices, and durable terminology.',
    'Ignore one-off task content and local document topics.',
    '',
    '[Output JSON]',
    '{',
    '  "shouldUpdate": boolean,',
    '  "nextSoulText": "complete updated Soul text, or the current text when shouldUpdate is false",',
    '  "reason": "short explanation based on the events"',
    '}',
  ].join('\n')
}

/**
 * Runs one model-driven Soul learning pass and returns a validated candidate.
 */
export async function runSoulLearning(args: RunSoulLearningArgs): Promise<SoulLearningResponse | null> {
  const url = joinOpenAICompatibleUrl(args.settings.baseUrl, '/chat/completions')
  const userPrompt = buildSoulLearningPrompt({
    currentSoulText: args.currentSoulText,
    events: args.events,
  })
  const body = buildChatCompletionBody({
    provider: args.settings.provider,
    baseUrl: args.settings.baseUrl,
    model: args.settings.model,
    systemPrompt: SOUL_LEARNING_SYSTEM_PROMPT,
    userPrompt,
    thinkingControlMode: args.settings.thinkingControlMode,
    temperature: 0.1,
    maxTokens: Math.max(args.settings.maxTokens, 512),
  })

  const response = await fetch(url, {
    method: 'POST',
    headers: buildOpenAICompatibleHeaders(args.settings.apiKey),
    body: JSON.stringify(body),
    signal: args.signal,
  })

  if (!response.ok) {
    const text = await safeReadText(response)
    throw new Error(`Soul learning HTTP ${response.status}: ${text.slice(0, 200)}`)
  }

  const payload: unknown = await response.json()
  const rawText = extractAssistantMessageContent(payload)
  return parseSoulLearningResponse(rawText, args.currentSoulText)
}

export function parseSoulLearningResponse(
  rawText: string,
  currentSoulText: string,
): SoulLearningResponse | null {
  const parsed = parseJsonObject(stripJsonFence(rawText))
  if (parsed === null) {
    return null
  }

  const shouldUpdate = parsed.shouldUpdate === true
  const nextSoulText = typeof parsed.nextSoulText === 'string'
    ? normalizeSoulLearningText(parsed.nextSoulText)
    : ''
  const reason = typeof parsed.reason === 'string'
    ? parsed.reason.trim().slice(0, 400)
    : ''

  if (!shouldUpdate) {
    return {
      shouldUpdate: false,
      nextSoulText: currentSoulText.trim(),
      reason,
    }
  }

  if (nextSoulText.length === 0 || nextSoulText === currentSoulText.trim()) {
    return null
  }

  return {
    shouldUpdate: true,
    nextSoulText,
    reason,
  }
}

function formatSoulLearningEvent(event: CompletionEvent): string {
  return JSON.stringify({
    action: event.action,
    host: event.host,
    prefix: truncateForPrompt(event.prefix),
    suggestion: truncateForPrompt(event.suggestion),
    timestamp: event.timestamp,
  })
}

function truncateForPrompt(value: string): string {
  return value.trim().slice(0, 240)
}

function normalizeSoulLearningText(value: string): string {
  return value
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .join('\n')
    .slice(0, SOUL_LEARNING_MAX_TEXT_CHARS)
}

function stripJsonFence(value: string): string {
  const trimmed = value.trim()
  if (!trimmed.startsWith('```') || !trimmed.endsWith('```')) {
    return trimmed
  }

  const lines = trimmed.split(/\r?\n/)
  if (lines.length < 2) {
    return trimmed
  }

  const firstLine = lines[0]?.trim().toLowerCase()
  const lastLine = lines.at(-1)?.trim()
  if ((firstLine !== '```' && firstLine !== '```json') || lastLine !== '```') {
    return trimmed
  }

  return lines.slice(1, -1).join('\n').trim()
}

function parseJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  }
  catch {
    return null
  }
}

async function safeReadText(response: Response): Promise<string> {
  try {
    return await response.text()
  }
  catch {
    return ''
  }
}
