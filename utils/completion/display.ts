/**
 * Derives the ghost-text fragment that should be rendered before the existing
 * suffix after the caret.
 *
 * Use when:
 * - a completion should avoid visually overlapping text that is already present
 *   after the cursor in the editor
 *
 * Expects:
 * - `completion` to be the full sanitized completion returned for the current request
 * - `suffix` to be the exact text that already exists after the caret
 *
 * Returns:
 * - the non-overlapping leading fragment of `completion`
 */
export function getDisplayCompletion(
  completion: string,
  suffix?: string,
): string {
  if (!completion || !suffix) {
    return completion
  }

  const maxOverlap = Math.min(completion.length, suffix.length)
  for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
    if (completion.endsWith(suffix.slice(0, overlap))) {
      return completion.slice(0, completion.length - overlap)
    }
  }

  return completion
}
