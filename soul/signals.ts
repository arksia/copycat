import type { CompletionEvent, SoulObservedSignal } from '~/types'

export interface DeriveSoulObservedSignalsArgs {
  event: CompletionEvent
  documentIds?: string[]
}

export interface DerivedSoulSignalTag {
  kind: SoulObservedSignal['kind']
  value: string
  evidence: SoulObservedSignal['evidence']
  contextKey: string
  documentIds: string[]
}

/**
 * Derives lightweight observed Soul signal tags from one completion event.
 *
 * Use when:
 * - local completion telemetry should feed slow Soul preference aggregation
 * - the system needs explicit, rule-based evidence before any later reflection work
 *
 * Expects:
 * - `event.suggestion` to contain the model continuation text already shown to the user
 *
 * Returns:
 * - a deduplicated set of stable signal tags for local aggregation
 */
export function deriveSoulObservedSignals(
  args: DeriveSoulObservedSignalsArgs,
): DerivedSoulSignalTag[] {
  const evidence = buildSoulSignalEvidence(args.event)
  const contextKey = buildSoulSignalContextKey(args.event)
  const tags: DerivedSoulSignalTag[] = []

  if (evidence.openingStructure !== 'unknown') {
    tags.push({
      kind: 'structure',
      value: evidence.openingStructure,
      evidence,
      contextKey,
      documentIds: args.documentIds ?? [],
    })
  }

  if (evidence.toneHints.includes('direct')) {
    tags.push({
      kind: 'preference',
      value: 'prefer-direct-tone',
      evidence,
      contextKey,
      documentIds: args.documentIds ?? [],
    })
  }

  if (evidence.toneHints.includes('marketing-like')) {
    tags.push({
      kind: 'avoidance',
      value: 'avoid-marketing-language',
      evidence,
      contextKey,
      documentIds: args.documentIds ?? [],
    })
  }

  for (const term of evidence.termHits) {
    tags.push({
      kind: 'term',
      value: `term:${term}`,
      evidence,
      contextKey,
      documentIds: args.documentIds ?? [],
    })
  }

  return dedupeDerivedSoulSignalTags(tags)
}

/**
 * Builds one structured evidence row from a completion event.
 *
 * Use when:
 * - signal aggregation needs stable local evidence
 * - debug payloads should explain why a signal exists
 *
 * Returns:
 * - the normalized evidence shape stored on observed Soul signals
 */
export function buildSoulSignalEvidence(event: CompletionEvent): SoulObservedSignal['evidence'] {
  return {
    action: event.action,
    host: event.host,
    prefixPreview: truncateForSoulSignal(event.prefix),
    suggestionPreview: truncateForSoulSignal(event.suggestion),
    suggestionLengthBucket: classifySuggestionLength(event.suggestion),
    openingStructure: detectOpeningStructure(event.suggestion),
    toneHints: detectToneHints(event.suggestion),
    termHits: extractSoulTermHits(event.prefix, event.suggestion),
    timestamp: event.timestamp,
  }
}

export function buildSoulSignalContextKey(event: CompletionEvent): string {
  const normalizedPrefix = event.prefix.trim().toLowerCase()
  return `${event.host}::${hashSoulContextKey(normalizedPrefix)}`
}

function classifySuggestionLength(text: string): 'short' | 'medium' | 'long' {
  if (text.length <= 48) {
    return 'short'
  }
  if (text.length <= 160) {
    return 'medium'
  }
  return 'long'
}

function detectOpeningStructure(
  text: string,
): 'answer-first' | 'context-first' | 'list-first' | 'unknown' {
  const trimmed = text.trim()
  if (!trimmed) {
    return 'unknown'
  }

  if (trimmed.startsWith('-') || trimmed.startsWith('*')) {
    return 'list-first'
  }

  if (/^(?:first|start|directly|先|直接|结论)/i.test(trimmed)) {
    return 'answer-first'
  }

  if (/^(?:because|context|背景|为了)/i.test(trimmed)) {
    return 'context-first'
  }

  return 'unknown'
}

function detectToneHints(text: string): string[] {
  const trimmed = text.trim()
  const hints: string[] = []

  if (/[!！]/.test(trimmed) || /\b(?:amazing|best|powerful|incredible)\b/i.test(trimmed)) {
    hints.push('marketing-like')
  }

  if (/^(?:please|建议|可以|可考虑)/i.test(trimmed)) {
    hints.push('soft')
  }

  if (/^(?:first|start|directly|先|直接|结论)/i.test(trimmed)) {
    hints.push('direct')
  }

  return hints
}

export function extractSoulTermHits(prefix: string, suggestion: string): string[] {
  const prefixTerms = new Set(extractSoulTerms(prefix))
  const suggestionTerms = extractSoulTerms(suggestion)

  return [...new Set(suggestionTerms.filter(term => prefixTerms.has(term)))]
}

function extractSoulTerms(text: string): string[] {
  const normalized = text.toLowerCase()
  const terms = new Set<string>()

  const latinMatches = normalized.match(/[a-z][a-z0-9-]+/g) ?? []
  for (const term of latinMatches) {
    if (term.length >= 3) {
      terms.add(term)
    }
  }

  const hanMatches = normalized.match(/\p{Script=Han}{2,}/gu) ?? []
  for (const phrase of hanMatches) {
    for (const term of collectHanTerms(phrase)) {
      terms.add(term)
    }
  }

  return [...terms]
}

function dedupeDerivedSoulSignalTags(tags: DerivedSoulSignalTag[]): DerivedSoulSignalTag[] {
  const seen = new Set<string>()
  const deduped: DerivedSoulSignalTag[] = []

  for (const tag of tags) {
    const key = `${tag.kind}:${tag.value}`
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    deduped.push(tag)
  }

  return deduped
}

function truncateForSoulSignal(text: string): string {
  return text.trim().slice(0, 120)
}

function collectHanTerms(value: string): string[] {
  const terms = new Set<string>([value])

  for (const windowSize of [4, 3, 2]) {
    if (value.length < windowSize) {
      continue
    }

    for (let index = 0; index <= value.length - windowSize; index += 1) {
      terms.add(value.slice(index, index + windowSize))
    }
  }

  return [...terms]
}

function hashSoulContextKey(value: string): string {
  let hash = 0

  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash) + value.charCodeAt(index)
    hash |= 0
  }

  return Math.abs(hash).toString(36)
}
