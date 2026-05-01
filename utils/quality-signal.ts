import type { CompletionEventStats } from '~/types'

/**
 * Lightweight quality signal derived from recent local completion telemetry.
 *
 * Use when:
 * - debug surfaces want a compact interpretation of recent completion outcomes
 * - future retrieval tuning needs one simple, explainable decision signal
 *
 * Returns:
 * - a small qualitative band plus whether knowledge retrieval should be boosted
 */
export interface CompletionQualitySignal {
  band: 'healthy' | 'insufficient_data' | 'mixed' | 'poor'
  shouldBoostKnowledge: boolean
  reason: string
}

/**
 * Interprets recent completion telemetry into one simple quality signal.
 *
 * Use when:
 * - callers need a stable heuristic without changing request semantics yet
 * - recent local accept / reject / ignore history should be summarized for debugging
 *
 * Expects:
 * - `stats` to describe recent host-local completion outcomes
 *
 * Returns:
 * - one explainable signal suitable for debug output or later light strategy hooks
 */
export function deriveCompletionQualitySignal(
  stats: CompletionEventStats,
): CompletionQualitySignal {
  if (stats.total < 5) {
    return {
      band: 'insufficient_data',
      shouldBoostKnowledge: false,
      reason: 'Not enough local completion history yet.',
    }
  }

  if (stats.acceptanceRate >= 0.6) {
    return {
      band: 'healthy',
      shouldBoostKnowledge: false,
      reason: 'Recent completions are being accepted consistently.',
    }
  }

  if (stats.acceptanceRate >= 0.3) {
    return {
      band: 'mixed',
      shouldBoostKnowledge: false,
      reason: 'Recent completions are inconsistent and may need closer review.',
    }
  }

  return {
    band: 'poor',
    shouldBoostKnowledge: true,
    reason: 'Recent completions are often rejected or ignored.',
  }
}
