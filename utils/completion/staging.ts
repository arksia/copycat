import type { CompletionResponse } from '~/types'

/**
 * Whether a completion response should trigger the optional enhanced follow-up request.
 *
 * Use when:
 * - the fast stage has already returned
 * - the caller needs one consistent rule for requesting the enhanced follow-up
 *
 * Returns:
 * - `true` only when the fast stage explicitly requests an enhanced follow-up
 */
export function shouldRequestEnhancedStage(response: CompletionResponse): boolean {
  return response.stage === 'fast' && response.shouldRunEnhancedStage
}

/**
 * Whether an enhanced completion should replace the currently shown suggestion.
 *
 * Use when:
 * - the enhanced stage returns after the fast stage
 * - a UI surface must decide whether replacing the current ghost text is worthwhile
 *
 * Returns:
 * - `true` when the enhanced result is non-empty, different, and at least as informative
 */
export function shouldPreferEnhancedCompletion(
  currentSuggestion: string,
  enhancedSuggestion: string,
): boolean {
  if (enhancedSuggestion.length === 0) {
    return false
  }
  if (currentSuggestion.length === 0) {
    return true
  }
  if (enhancedSuggestion === currentSuggestion) {
    return false
  }
  return enhancedSuggestion.length >= currentSuggestion.length
}

/**
 * Derives the user-facing enhanced-stage outcome label for playground debugging.
 *
 * Use when:
 * - the UI needs a compact outcome summary for the staged completion flow
 * - callers want to avoid duplicating `triggered/replaced` branching logic
 *
 * Returns:
 * - `skipped`, `replaced`, or `kept_fast`
 */
export function summarizeEnhancedOutcome(args: {
  triggered: boolean
  replaced: boolean
}): 'kept_fast' | 'replaced' | 'skipped' {
  if (!args.triggered) {
    return 'skipped'
  }
  return args.replaced ? 'replaced' : 'kept_fast'
}

/**
 * Builds a short, readable staged-completion activity timeline for the playground.
 *
 * Use when:
 * - the user needs to inspect whether the enhanced stage ran
 * - fast and enhanced completion outcomes should be explained side-by-side
 *
 * Returns:
 * - ordered activity lines suitable for direct UI rendering
 */
export function buildStageActivityLines(args: {
  fastCompletion: string
  shouldRunEnhancedStage: boolean
  enhancedCompletion: string
  enhancedReplaced: boolean
}): string[] {
  const lines = ['fast: completed']

  if (!args.shouldRunEnhancedStage) {
    lines.push('enhanced: not requested')
    return lines
  }

  lines.push('fast: requested enhanced follow-up')
  lines.push('enhanced: completed')
  lines.push(
    args.enhancedReplaced
      ? 'enhanced: replaced fast suggestion'
      : 'enhanced: kept fast suggestion',
  )
  return lines
}
