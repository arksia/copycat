import type { PersistedCompletionCacheEntry } from '../schema'
import { openCopycatDb, requestToPromise, transactionToPromise } from '../client'
import { DB_STORES } from '../schema'

/**
 * Persists a completion cache entry for reuse after service-worker sleep.
 *
 * Use when:
 * - a fresh completion response should survive the current background worker lifetime
 * - future requests may benefit from a structured local cache hit
 *
 * Expects:
 * - `entry.key` to be unique per completion identity
 * - `entry.expiresAt` to be in Unix milliseconds
 *
 * Returns:
 * - nothing
 */
export async function putPersistedCompletion(
  entry: PersistedCompletionCacheEntry,
): Promise<void> {
  const db = await openCopycatDb()
  const transaction = db.transaction(DB_STORES.completionCache, 'readwrite')
  transaction.objectStore(DB_STORES.completionCache).put(entry)
  await transactionToPromise(transaction)
}

/**
 * Reads a persisted completion cache entry if it is still fresh.
 *
 * Use when:
 * - a request misses the in-memory cache but might still hit durable local cache
 * - callers want expired rows cleaned up opportunistically
 *
 * Expects:
 * - `key` to come from the same cache-key builder used during writes
 *
 * Returns:
 * - the cached completion text, or `null` when absent or expired
 */
export async function getPersistedCompletion(
  key: string,
  now = Date.now(),
): Promise<string | null> {
  const db = await openCopycatDb()
  const transaction = db.transaction(DB_STORES.completionCache, 'readwrite')
  const store = transaction.objectStore(DB_STORES.completionCache)
  const entry = await requestToPromise(
    store.get(key) as IDBRequest<PersistedCompletionCacheEntry | undefined>,
  )

  if (entry === undefined) {
    await transactionToPromise(transaction)
    return null
  }

  if (entry.expiresAt <= now) {
    store.delete(key)
    await transactionToPromise(transaction)
    return null
  }

  await transactionToPromise(transaction)
  return entry.value
}
