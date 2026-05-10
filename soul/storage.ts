import type { SoulObservedSignal, SoulObservedSignalSnapshot } from '~/types'
import { nextId } from '~/utils/core/base'
import { openCopycatDb, requestToPromise, transactionToPromise } from '~/utils/db/client'
import { DB_INDEXES, DB_STORES } from '~/utils/db/schema'

export interface ListSoulObservedSignalsArgs {
  limit?: number
  matureOnly?: boolean
}

export interface UpsertSoulObservedSignalArgs {
  kind: SoulObservedSignal['kind']
  value: string
  evidence: SoulObservedSignal['evidence']
  contextKey: string
  documentIds: string[]
}

/**
 * Persists one fully formed observed Soul signal row.
 *
 * Use when:
 * - tests need deterministic seeded signals
 * - callers already own the final aggregated record shape
 *
 * Expects:
 * - `signal.id` to be stable for the stored row
 *
 * Returns:
 * - nothing
 */
export async function putSoulObservedSignal(signal: SoulObservedSignal): Promise<void> {
  const db = await openCopycatDb()
  const transaction = db.transaction(DB_STORES.soulObservedSignals, 'readwrite')
  transaction.objectStore(DB_STORES.soulObservedSignals).put(signal)
  await transactionToPromise(transaction)
}

/**
 * Upserts one observed Soul signal bucket keyed by `(kind, value)`.
 *
 * Use when:
 * - completion telemetry derives a stable Soul signal tag
 * - repeated matching events should aggregate instead of creating duplicates
 *
 * Expects:
 * - `kind` and `value` to describe one stable normalized signal bucket
 *
 * Returns:
 * - the stored aggregate row after the update
 */
export async function upsertSoulObservedSignal(
  args: UpsertSoulObservedSignalArgs,
): Promise<SoulObservedSignal> {
  const db = await openCopycatDb()
  const transaction = db.transaction(DB_STORES.soulObservedSignals, 'readwrite')
  const store = transaction.objectStore(DB_STORES.soulObservedSignals)
  const index = store.index(DB_INDEXES.soulObservedSignalsByKindValue)
  const existing = await requestToPromise(
    index.get([args.kind, args.value]) as IDBRequest<SoulObservedSignal | undefined>,
  )
  const next = existing === undefined
    ? createInitialSoulObservedSignal(args)
    : mergeSoulObservedSignal(existing, args)

  next.confidence = computeSoulSignalConfidence(next)
  store.put(next)
  await transactionToPromise(transaction)
  return next
}

/**
 * Lists observed Soul signals in newest-first order.
 *
 * Use when:
 * - debug surfaces want the latest signal state
 * - callers want either all signals or only mature candidates
 *
 * Expects:
 * - `limit` to stay reasonably small for dev inspection
 *
 * Returns:
 * - the most recent observed Soul signals after optional maturity filtering
 */
export async function listSoulObservedSignals(
  args: ListSoulObservedSignalsArgs = {},
): Promise<SoulObservedSignal[]> {
  const all = await listSoulObservedSignalsByRecency(args.limit ?? 20)
  return args.matureOnly ? all.filter(isSoulObservedSignalMature) : all
}

/**
 * Builds one compact snapshot for debug or dev inspection.
 *
 * Use when:
 * - playground or future devtools need a single Soul signal payload
 * - callers want total and mature counts without recomputing filters
 *
 * Returns:
 * - a recency-ordered signal snapshot
 */
export async function getSoulObservedSignalSnapshot(
  args: ListSoulObservedSignalsArgs = {},
): Promise<SoulObservedSignalSnapshot> {
  const all = await listSoulObservedSignalsByRecency(args.limit ?? 20)
  const matureSignals = all.filter(isSoulObservedSignalMature)

  return {
    totalCount: all.length,
    matureCount: matureSignals.length,
    signals: args.matureOnly ? matureSignals : all,
  }
}

/**
 * Decides whether one observed Soul signal is stable enough for v1 inspection.
 *
 * Use when:
 * - callers need to distinguish raw evidence from candidate long-term preferences
 * - future reflection work should only consume mature signals
 *
 * Returns:
 * - `true` when the signal satisfies the v1 maturity thresholds
 */
export function isSoulObservedSignalMature(signal: SoulObservedSignal): boolean {
  return signal.count >= 3
    && signal.distinctContextCount >= 2
    && signal.acceptedCount > signal.rejectedCount
}

function createInitialSoulObservedSignal(args: UpsertSoulObservedSignalArgs): SoulObservedSignal {
  return {
    id: nextId(`soul_${args.kind}`),
    kind: args.kind,
    value: args.value,
    confidence: 0,
    count: 1,
    acceptedCount: args.evidence.action === 'accepted' ? 1 : 0,
    rejectedCount: args.evidence.action === 'rejected' ? 1 : 0,
    ignoredCount: args.evidence.action === 'ignored' ? 1 : 0,
    distinctContextCount: 1,
    firstSeenAt: args.evidence.timestamp,
    lastSeenAt: args.evidence.timestamp,
    evidence: args.evidence,
    contextKeys: [args.contextKey],
    documentIds: [...args.documentIds],
  }
}

function mergeSoulObservedSignal(
  current: SoulObservedSignal,
  args: UpsertSoulObservedSignalArgs,
): SoulObservedSignal {
  const contextKeys = current.contextKeys.includes(args.contextKey)
    ? current.contextKeys
    : [...current.contextKeys, args.contextKey]
  const documentIds = mergeUniqueStrings(current.documentIds, args.documentIds)

  return {
    ...current,
    count: current.count + 1,
    acceptedCount: current.acceptedCount + (args.evidence.action === 'accepted' ? 1 : 0),
    rejectedCount: current.rejectedCount + (args.evidence.action === 'rejected' ? 1 : 0),
    ignoredCount: current.ignoredCount + (args.evidence.action === 'ignored' ? 1 : 0),
    distinctContextCount: contextKeys.length,
    lastSeenAt: args.evidence.timestamp,
    evidence: args.evidence,
    contextKeys,
    documentIds,
  }
}

function computeSoulSignalConfidence(signal: SoulObservedSignal): number {
  if (signal.count === 0) {
    return 0
  }

  const acceptanceBias = (signal.acceptedCount - signal.rejectedCount) / signal.count
  const contextBias = Math.min(signal.distinctContextCount / 3, 1)
  return Number(Math.max(0, Math.min(1, (acceptanceBias * 0.7) + (contextBias * 0.3))).toFixed(2))
}

async function listSoulObservedSignalsByRecency(limit: number): Promise<SoulObservedSignal[]> {
  const db = await openCopycatDb()
  const transaction = db.transaction(DB_STORES.soulObservedSignals, 'readonly')
  const index = transaction
    .objectStore(DB_STORES.soulObservedSignals)
    .index(DB_INDEXES.soulObservedSignalsByLastSeenAt)
  const signals = await collectSoulSignalCursorValues(
    index.openCursor(null, 'prev'),
    limit,
  )

  await transactionToPromise(transaction)
  return signals
}

async function collectSoulSignalCursorValues(
  request: IDBRequest<IDBCursorWithValue | null>,
  limit: number,
): Promise<SoulObservedSignal[]> {
  return new Promise((resolve, reject) => {
    const values: SoulObservedSignal[] = []

    request.onsuccess = () => {
      const cursor = request.result
      if (cursor === null || values.length >= limit) {
        resolve(values)
        return
      }

      values.push(cursor.value as SoulObservedSignal)
      cursor.continue()
    }

    request.onerror = () => reject(request.error ?? new Error('Failed to iterate Soul signal cursor'))
  })
}

function mergeUniqueStrings(current: string[], incoming: string[]): string[] {
  if (incoming.length === 0) {
    return current
  }

  return [...new Set([...current, ...incoming])]
}
