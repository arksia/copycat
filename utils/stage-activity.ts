/**
 * Derives the user-facing enhanced-stage outcome label for playground debugging.
 *
 * Use when:
 * - the UI needs a compact outcome summary for the second stage
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
 * Builds a short, readable two-stage activity timeline for the playground.
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
