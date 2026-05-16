/**
 * Whether inline completion is supported at the current caret position.
 *
 * Use when:
 * - the current product surface should only offer completions at the end of the text
 *
 * Expects:
 * - `suffix` to be the exact text after the caret
 *
 * Returns:
 * - `true` only when the caret is at the end of the current text
 */
export function supportsInlineCompletion(suffix?: string): boolean {
  return (suffix ?? '').length === 0
}
