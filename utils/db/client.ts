import { DB_INDEXES, DB_NAME, DB_STORES, DB_VERSION } from './schema'

let activeDb: IDBDatabase | null = null
let openPromise: Promise<IDBDatabase> | null = null

/**
 * Opens the shared Copycat IndexedDB database and applies schema upgrades.
 *
 * Use when:
 * - repositories need structured local storage
 * - background code needs data that should survive service-worker sleep
 *
 * Expects:
 * - the environment to provide IndexedDB
 *
 * Returns:
 * - an open `IDBDatabase` instance cached for reuse
 */
export async function openCopycatDb(): Promise<IDBDatabase> {
  if (activeDb !== null) {
    return activeDb
  }
  if (openPromise !== null) {
    return openPromise
  }

  openPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(DB_STORES.completionEvents)) {
        const completionEvents = db.createObjectStore(DB_STORES.completionEvents, {
          keyPath: 'id',
        })
        completionEvents.createIndex(DB_INDEXES.completionEventsByTimestamp, 'timestamp')
        completionEvents.createIndex(DB_INDEXES.completionEventsByHostTimestamp, ['host', 'timestamp'])
      }

      if (!db.objectStoreNames.contains(DB_STORES.completionCache)) {
        const completionCache = db.createObjectStore(DB_STORES.completionCache, {
          keyPath: 'key',
        })
        completionCache.createIndex(DB_INDEXES.completionCacheByExpiresAt, 'expiresAt')
      }

      if (!db.objectStoreNames.contains(DB_STORES.knowledgeDocuments)) {
        const knowledgeDocuments = db.createObjectStore(DB_STORES.knowledgeDocuments, {
          keyPath: 'id',
        })
        knowledgeDocuments.createIndex(DB_INDEXES.knowledgeDocumentsByKnowledgeBase, 'kbId')
      }

      if (!db.objectStoreNames.contains(DB_STORES.knowledgeChunks)) {
        const knowledgeChunks = db.createObjectStore(DB_STORES.knowledgeChunks, {
          keyPath: 'id',
        })
        knowledgeChunks.createIndex(DB_INDEXES.knowledgeChunksByDocument, 'docId')
        knowledgeChunks.createIndex(DB_INDEXES.knowledgeChunksByKnowledgeBase, 'kbId')
        knowledgeChunks.createIndex(DB_INDEXES.knowledgeChunksByKeyword, 'keywords', {
          multiEntry: true,
        })
      }

      if (!db.objectStoreNames.contains(DB_STORES.soulObservedSignals)) {
        const soulObservedSignals = db.createObjectStore(DB_STORES.soulObservedSignals, {
          keyPath: 'id',
        })
        soulObservedSignals.createIndex(DB_INDEXES.soulObservedSignalsByLastSeenAt, 'lastSeenAt')
        soulObservedSignals.createIndex(DB_INDEXES.soulObservedSignalsByKindValue, ['kind', 'value'], {
          unique: true,
        })
      }
    }

    request.onsuccess = () => {
      const db = request.result
      db.onversionchange = () => {
        db.close()
        if (activeDb === db) {
          activeDb = null
        }
        openPromise = null
      }
      activeDb = db
      openPromise = null
      resolve(db)
    }

    request.onerror = () => {
      openPromise = null
      reject(request.error ?? new Error('Failed to open IndexedDB database'))
    }

    request.onblocked = () => {
      reject(new Error('IndexedDB upgrade is blocked by another open Copycat context'))
    }
  })

  return openPromise
}

/**
 * Converts an IndexedDB request into a promise.
 *
 * Use when:
 * - repository code wants async/await instead of callback-style request handlers
 * - the caller needs the request result or failure reason
 *
 * Expects:
 * - `request` to belong to an active IndexedDB transaction
 *
 * Returns:
 * - the request result once the operation succeeds
 */
export async function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
  })
}

/**
 * Waits for an IndexedDB transaction to finish.
 *
 * Use when:
 * - a repository performs one or more writes
 * - the caller needs to know the transaction committed successfully
 *
 * Expects:
 * - `transaction` to already contain all scheduled operations
 *
 * Returns:
 * - a promise that resolves after commit or rejects on abort/error
 */
export async function transactionToPromise(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'))
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'))
  })
}

/**
 * Closes the cached IndexedDB connection if one is currently open.
 *
 * Use when:
 * - tests need a clean database lifecycle
 * - a caller wants to release the cached connection explicitly
 *
 * Returns:
 * - nothing
 */
export function closeCopycatDb(): void {
  if (activeDb !== null) {
    activeDb.close()
    activeDb = null
  }
  openPromise = null
}

/**
 * Deletes the entire Copycat IndexedDB database.
 *
 * Use when:
 * - tests need to reset local structured data between runs
 * - future maintenance or reset flows need a full database wipe
 *
 * Returns:
 * - a promise that resolves once the delete request completes
 */
export async function deleteCopycatDb(): Promise<void> {
  closeCopycatDb()

  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error ?? new Error('Failed to delete IndexedDB database'))
    request.onblocked = () => reject(new Error('IndexedDB delete is blocked by another open Copycat context'))
  })
}
