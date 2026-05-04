import type { CompletionEvent, CompletionEventStats } from '~/types'
import { openCopycatDb, transactionToPromise } from '../client'
import { DB_INDEXES, DB_STORES } from '../schema'

/**
 * Writes one completion event into the local telemetry store.
 *
 * Use when:
 * - accept / reject / ignore actions should feed later Soul or telemetry work
 * - event logging must stay local and structured
 *
 * Expects:
 * - `event.id` to be unique
 *
 * Returns:
 * - nothing
 */
export async function putCompletionEvent(event: CompletionEvent): Promise<void> {
  const db = await openCopycatDb()
  const transaction = db.transaction(DB_STORES.completionEvents, 'readwrite')
  transaction.objectStore(DB_STORES.completionEvents).put(event)
  await transactionToPromise(transaction)
}

/**
 * Lists recent completion events for one host, newest first.
 *
 * Use when:
 * - popup or settings surfaces need recent local telemetry
 * - future learning jobs want a bounded host-specific event window
 *
 * Expects:
 * - `host` to be the current page hostname
 * - `limit` to be a small positive integer
 *
 * Returns:
 * - the newest matching events, up to `limit`
 */
export async function listRecentCompletionEventsByHost(
  host: string,
  limit = 20,
): Promise<CompletionEvent[]> {
  const db = await openCopycatDb()
  const transaction = db.transaction(DB_STORES.completionEvents, 'readonly')
  const index = transaction
    .objectStore(DB_STORES.completionEvents)
    .index(DB_INDEXES.completionEventsByHostTimestamp)

  const maxTimestamp = Number.MAX_SAFE_INTEGER
  const range = IDBKeyRange.bound([host, 0], [host, maxTimestamp])
  const events = await collectCursorValues<CompletionEvent>(
    index.openCursor(range, 'prev'),
    limit,
  )

  await transactionToPromise(transaction)
  return events
}

/**
 * Aggregates recent completion outcomes for one host into a compact local telemetry summary.
 *
 * Use when:
 * - settings or popup surfaces need a quick health check for one site
 * - later learning logic needs lightweight acceptance signals without scanning full raw events repeatedly
 *
 * Expects:
 * - `host` to be the current page hostname
 *
 * Returns:
 * - total counts, acceptance rate, and average latency for that host
 */
export async function getCompletionEventStats(
  host: string,
  limit = 20,
): Promise<CompletionEventStats> {
  const events = await listRecentCompletionEventsByHost(host, limit)
  if (events.length === 0) {
    return {
      total: 0,
      accepted: 0,
      rejected: 0,
      ignored: 0,
      acceptanceRate: 0,
      averageLatencyMs: 0,
    }
  }

  let accepted = 0
  let rejected = 0
  let ignored = 0
  let totalLatency = 0

  for (const event of events) {
    totalLatency += event.latencyMs

    if (event.action === 'accepted') {
      accepted += 1
      continue
    }
    if (event.action === 'rejected') {
      rejected += 1
      continue
    }
    ignored += 1
  }

  return {
    total: events.length,
    accepted,
    rejected,
    ignored,
    acceptanceRate: Number((accepted / events.length).toFixed(2)),
    averageLatencyMs: Math.round(totalLatency / events.length),
  }
}

async function collectCursorValues<T>(
  request: IDBRequest<IDBCursorWithValue | null>,
  limit: number,
): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const values: T[] = []

    request.onsuccess = () => {
      const cursor = request.result
      if (cursor === null || values.length >= limit) {
        resolve(values)
        return
      }

      values.push(cursor.value as T)
      cursor.continue()
    }

    request.onerror = () => reject(request.error ?? new Error('Failed to iterate IndexedDB cursor'))
  })
}
