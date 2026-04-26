import type { CompletionEvent, KnowledgeChunk, KnowledgeDocument } from '~/types'

/**
 * Stable IndexedDB database name for Copycat local data.
 *
 * Use when:
 * - opening the shared extension database
 * - deleting or resetting local structured data
 *
 * Returns:
 * - the single database name used by repositories in this extension
 */
export const DB_NAME = 'copycat'

/**
 * Current IndexedDB schema version for Copycat local data.
 *
 * Use when:
 * - evolving object stores or indexes
 * - handling future schema upgrades
 *
 * Returns:
 * - the active database version integer
 */
export const DB_VERSION = 2

/**
 * Shared object-store names used by the local data layer.
 *
 * Use when:
 * - creating object stores during schema upgrades
 * - opening repository transactions without duplicating string literals
 *
 * Returns:
 * - the stable object-store names for the current schema
 */
export const DB_STORES = {
  completionCache: 'completion-cache',
  completionEvents: 'completion-events',
  knowledgeChunks: 'knowledge-chunks',
  knowledgeDocuments: 'knowledge-documents',
} as const

/**
 * Shared index names used by IndexedDB repositories.
 *
 * Use when:
 * - creating object-store indexes during upgrade
 * - querying events or persisted completions efficiently
 *
 * Returns:
 * - the stable index names for the current schema
 */
export const DB_INDEXES = {
  completionCacheByExpiresAt: 'by-expires-at',
  completionEventsByHostTimestamp: 'by-host-timestamp',
  completionEventsByTimestamp: 'by-timestamp',
  knowledgeChunksByDocument: 'by-document',
  knowledgeChunksByKeyword: 'by-keyword',
  knowledgeChunksByKnowledgeBase: 'by-knowledge-base',
  knowledgeDocumentsByKnowledgeBase: 'by-knowledge-base',
} as const

/**
 * Persisted completion cache entry for cross-worker cache reuse.
 *
 * Use when:
 * - storing completions beyond in-memory service-worker lifetime
 * - rehydrating short-lived cache hits after worker sleep
 *
 * Expects:
 * - `key` to come from `buildCompletionCacheKey`
 * - `expiresAt` to be a Unix millisecond timestamp
 *
 * Returns:
 * - a single persisted cache row
 */
export interface PersistedCompletionCacheEntry {
  key: string
  value: string
  expiresAt: number
  updatedAt: number
}

/**
 * IndexedDB schema shape used by Copycat repositories.
 *
 * Use when:
 * - documenting which data belongs in structured local storage
 * - keeping repository boundaries explicit for future Phase 2 work
 *
 * Returns:
 * - the record type stored in each object store
 */
export interface CopycatDatabaseSchema {
  completionCache: PersistedCompletionCacheEntry
  completionEvents: CompletionEvent
  knowledgeChunks: KnowledgeChunk
  knowledgeDocuments: KnowledgeDocument
}
