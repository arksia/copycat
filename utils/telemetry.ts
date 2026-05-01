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
