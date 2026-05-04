import type { CompletionEvent, CompletionEventStats } from '~/types'

/**
 * Snapshot of the local completion telemetry state shown in settings.
 *
 * Use when:
 * - a UI surface needs both the aggregate stats and recent raw events
 * - telemetry failures should degrade to an explicit empty state
 *
 * Returns:
 * - one resolved telemetry payload safe to bind directly into UI state
 */
export interface TelemetrySnapshot {
  stats: CompletionEventStats | null
  events: CompletionEvent[]
  error: string
}

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
 * Loads the local telemetry snapshot for one host with failure-safe fallback behavior.
 *
 * Use when:
 * - settings wants optional telemetry without blocking the rest of the page
 * - callers need one consistent success-or-empty result shape
 *
 * Expects:
 * - `host` to be the active browser tab host when available
 * - loaders to resolve typed telemetry data for that host
 *
 * Returns:
 * - telemetry data on success, or an explicit empty snapshot on failure
 */
export async function loadTelemetrySnapshot(args: {
  host: string
  loadStats: () => Promise<CompletionEventStats>
  loadEvents: () => Promise<CompletionEvent[]>
}): Promise<TelemetrySnapshot> {
  if (!args.host) {
    return {
      stats: null,
      events: [],
      error: '',
    }
  }

  try {
    const stats = await args.loadStats()
    const events = await args.loadEvents()

    return {
      stats,
      events,
      error: '',
    }
  }
  catch (error) {
    return {
      stats: null,
      events: [],
      error: error instanceof Error ? error.message : String(error),
    }
  }
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
