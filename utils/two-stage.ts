import type { CompletionResponse } from '~/types'

/**
 * Whether a completion response should trigger the optional enhanced follow-up request.
 *
 * Use when:
 * - the fast stage has already returned
 * - the caller needs one consistent rule for requesting the second stage
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
