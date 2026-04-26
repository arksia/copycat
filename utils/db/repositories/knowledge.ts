import type { KnowledgeChunk, KnowledgeDocument } from '~/types'
import { extractKnowledgeKeywords } from '~/utils/knowledge/chunker'
import { retrieveKnowledge } from '~/utils/knowledge/retriever'
import { openCopycatDb, requestToPromise, transactionToPromise } from '../client'
import { DB_INDEXES, DB_STORES } from '../schema'

/**
 * Persists one knowledge document record.
 *
 * Use when:
 * - imported document metadata should be available for later retrieval
 * - callers want document listing separate from chunk text storage
 *
 * Expects:
 * - `document.id` to be stable for one imported source
 *
 * Returns:
 * - nothing
 */
export async function putKnowledgeDocument(document: KnowledgeDocument): Promise<void> {
  const db = await openCopycatDb()
  const transaction = db.transaction(DB_STORES.knowledgeDocuments, 'readwrite')
  transaction.objectStore(DB_STORES.knowledgeDocuments).put(document)
  await transactionToPromise(transaction)
}

/**
 * Persists a batch of knowledge chunks for one or more documents.
 *
 * Use when:
 * - chunking has completed and retrieval data should be stored locally
 * - callers already hold the final chunk array in memory
 *
 * Expects:
 * - all chunks to contain precomputed `keywords`
 *
 * Returns:
 * - nothing
 */
export async function putKnowledgeChunks(chunks: KnowledgeChunk[]): Promise<void> {
  if (chunks.length === 0) {
    return
  }

  const db = await openCopycatDb()
  const transaction = db.transaction(DB_STORES.knowledgeChunks, 'readwrite')
  const store = transaction.objectStore(DB_STORES.knowledgeChunks)

  for (const chunk of chunks) {
    store.put(chunk)
  }

  await transactionToPromise(transaction)
}

/**
 * Lists stored knowledge documents for one knowledge base.
 *
 * Use when:
 * - UI or import flows need document metadata without loading all chunk text
 * - callers want documents scoped to one knowledge base
 *
 * Expects:
 * - `kbId` to identify one logical knowledge base
 *
 * Returns:
 * - the stored documents for that knowledge base
 */
export async function listKnowledgeDocuments(kbId: string): Promise<KnowledgeDocument[]> {
  const db = await openCopycatDb()
  const transaction = db.transaction(DB_STORES.knowledgeDocuments, 'readonly')
  const index = transaction
    .objectStore(DB_STORES.knowledgeDocuments)
    .index(DB_INDEXES.knowledgeDocumentsByKnowledgeBase)
  const documents = await requestToPromise(
    index.getAll(IDBKeyRange.only(kbId)) as IDBRequest<KnowledgeDocument[]>,
  )

  await transactionToPromise(transaction)
  return documents
}

/**
 * Deletes one knowledge document and its derived chunks from local storage.
 *
 * Use when:
 * - a user removes imported material from the local knowledge base
 * - callers need document and chunk cleanup to stay consistent
 *
 * Expects:
 * - `docId` to belong to the target knowledge base
 *
 * Returns:
 * - the number of removed chunks
 */
export async function deleteKnowledgeDocument(args: {
  docId: string
  kbId: string
}): Promise<number> {
  const db = await openCopycatDb()
  const transaction = db.transaction(
    [DB_STORES.knowledgeDocuments, DB_STORES.knowledgeChunks],
    'readwrite',
  )
  const chunkStore = transaction.objectStore(DB_STORES.knowledgeChunks)
  const chunkIndex = chunkStore.index(DB_INDEXES.knowledgeChunksByDocument)
  const chunkKeys = await requestToPromise(
    chunkIndex.getAllKeys(IDBKeyRange.only(args.docId)),
  )

  for (const chunkKey of chunkKeys) {
    chunkStore.delete(chunkKey)
  }
  transaction.objectStore(DB_STORES.knowledgeDocuments).delete(args.docId)

  await transactionToPromise(transaction)
  return chunkKeys.length
}

/**
 * Searches stored knowledge chunks for one knowledge base with lightweight keyword retrieval.
 *
 * Use when:
 * - a caller needs local grounding snippets without embeddings
 * - the current phase should stay lightweight and deterministic
 *
 * Expects:
 * - `query` to be non-empty natural language text
 *
 * Returns:
 * - the top-ranked chunks after keyword prefiltering and in-memory reranking
 */
export async function searchKnowledgeChunks(args: {
  kbId: string
  query: string
  topK: number
}): Promise<KnowledgeChunk[]> {
  const queryTerms = extractKnowledgeKeywords(args.query)
  if (queryTerms.length === 0) {
    return []
  }

  const db = await openCopycatDb()
  const transaction = db.transaction(DB_STORES.knowledgeChunks, 'readonly')
  const index = transaction
    .objectStore(DB_STORES.knowledgeChunks)
    .index(DB_INDEXES.knowledgeChunksByKeyword)

  const candidates = new Map<string, KnowledgeChunk>()

  for (const term of queryTerms) {
    const matches = await requestToPromise(
      index.getAll(IDBKeyRange.only(term)) as IDBRequest<KnowledgeChunk[]>,
    )
    for (const chunk of matches) {
      if (chunk.kbId === args.kbId) {
        candidates.set(chunk.id, chunk)
      }
    }
  }

  await transactionToPromise(transaction)

  return retrieveKnowledge({
    chunks: [...candidates.values()],
    query: args.query,
    topK: args.topK,
  })
}
