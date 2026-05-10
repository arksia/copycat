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

  if (evidence.openingStructure === 'answer-first') {
    tags.push({
      kind: 'structure',
      value: 'answer-first',
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
    termHits: extractTermHits(event.prefix, event.suggestion),
    timestamp: event.timestamp,
  }
}

function buildSoulSignalContextKey(event: CompletionEvent): string {
  const prefix = event.prefix.trim().toLowerCase().slice(0, 24)
  return `${event.host}::${prefix}`
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

  if (/^(first|start|directly|先|直接|结论)/i.test(trimmed)) {
    return 'answer-first'
  }

  if (/^(because|context|背景|为了)/i.test(trimmed)) {
    return 'context-first'
  }

  return 'unknown'
}

function detectToneHints(text: string): string[] {
  const trimmed = text.trim()
  const hints: string[] = []

  if (/[!！]/.test(trimmed) || /\b(amazing|best|powerful|incredible)\b/i.test(trimmed)) {
    hints.push('marketing-like')
  }

  if (/^(please|建议|可以|可考虑)/i.test(trimmed)) {
    hints.push('soft')
  }

  if (/^(first|start|directly|先|直接|结论)/i.test(trimmed)) {
    hints.push('direct')
  }

  return hints
}

function extractTermHits(prefix: string, suggestion: string): string[] {
  const prefixTerms = new Set(extractWordTerms(prefix))
  const suggestionTerms = extractWordTerms(suggestion)

  return [...new Set(suggestionTerms.filter(term => prefixTerms.has(term)))]
}

function extractWordTerms(text: string): string[] {
  const matches = text.toLowerCase().match(/[a-z][a-z0-9-]{1,}/g) ?? []
  return matches.filter(term => term.length >= 3)
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
