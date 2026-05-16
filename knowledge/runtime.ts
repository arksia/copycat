import type {
  CompletionDebugInfo,
  KnowledgeChunk,
  KnowledgeChunkEmbedding,
  KnowledgeDocument,
  KnowledgeImportRequest,
  KnowledgeImportResult,
} from '~/types'
import { buildKnowledgeDocumentEmbedding } from './embedding'
import {
  buildKnowledgeDocumentId,
  buildKnowledgeDocumentRecord,
  computeKnowledgeChecksum,
} from './import'
import { buildKnowledgeContextProjection, buildKnowledgeSearchQuery } from './prompt'
import { resolveSemanticSimilarity } from './retriever'
import {
  listKnowledgeChunksByDocumentIds,
  listKnowledgeDocuments,
  putKnowledgeChunks,
  putKnowledgeDocument,
  searchKnowledgeChunks,
} from './storage'

export interface KnowledgeOffscreenMarkdownResult {
  chunks: KnowledgeChunk[]
  normalizedText: string
}

export interface SemanticQueryResolution {
  meta?: {
    backend: KnowledgeChunkEmbedding['backend']
    latencyMs: number
    model: string
    queryEmbedding: number[]
  }
  state: 'cache_hit' | 'computed' | 'skipped'
}

export interface ResolveCompletionKnowledgeArgs {
  budget: {
    topK: number
    maxChars: number
  }
  defaultKnowledgeBaseId: string
  knowledgeDocumentTopK: number
  minPrefixChars: number
  prefix: string
  resolveSemanticQueryEmbedding: (
    query: string,
    embeddedChunkCount: number,
  ) => Promise<SemanticQueryResolution | undefined>
}

export interface ResolveCompletionKnowledgeResult {
  chunks: KnowledgeChunk[]
  context?: string
  budgetMeta?: CompletionDebugInfo['knowledgeBudgetMeta']
  query?: string
  recall?: CompletionDebugInfo['knowledgeRecall']
  rerank?: CompletionDebugInfo['knowledgeRerank']
  timings?: NonNullable<CompletionDebugInfo['timings']>['knowledge']
}

/**
 * Imports one Markdown knowledge document through the existing offscreen pipeline.
 *
 * Use when:
 * - background orchestration wants the full markdown -> chunk -> embed -> persist flow
 * - callers need one domain-level import function instead of inline steps
 *
 * Returns:
 * - the persisted knowledge document plus stored chunk count
 */
export async function importMarkdownKnowledge(args: {
  embedChunks: (chunks: KnowledgeChunk[]) => Promise<Array<KnowledgeChunkEmbedding | undefined>>
  processMarkdown: (payload: {
    docId: string
    kbId: string
    rawContent: string
    sourceName: string
  }) => Promise<KnowledgeOffscreenMarkdownResult>
  request: KnowledgeImportRequest
}): Promise<KnowledgeImportResult> {
  const checksum = await computeKnowledgeChecksum(args.request.rawContent)
  const provisionalDocId = buildKnowledgeDocumentId({
    checksum,
    kbId: args.request.kbId,
    title: args.request.title,
  })
  const processed = await args.processMarkdown({
    docId: provisionalDocId,
    kbId: args.request.kbId,
    rawContent: args.request.rawContent,
    sourceName: args.request.title,
  })

  const normalizedChecksum = await computeKnowledgeChecksum(processed.normalizedText)
  const document = buildKnowledgeDocumentRecord({
    checksum: normalizedChecksum,
    chunkCount: processed.chunks.length,
    normalizedText: processed.normalizedText,
    request: args.request,
  })
  const finalChunks = processed.chunks.map((chunk, index) => ({
    ...chunk,
    id: `${document.id}:${index}`,
    docId: document.id,
    kbId: document.kbId,
  }))
  const embeddings = await args.embedChunks(finalChunks)
  const embeddedChunks = finalChunks.map((chunk, index) => ({
    ...chunk,
    embedding: embeddings[index],
  }))
  const embeddedDocument = {
    ...document,
    embedding: buildKnowledgeDocumentEmbedding(embeddings),
  }

  await putKnowledgeDocument(embeddedDocument)
  await putKnowledgeChunks(embeddedChunks)

  return {
    chunkCount: embeddedChunks.length,
    document: embeddedDocument,
  }
}

/**
 * Resolves the packed knowledge context for one completion request.
 *
 * Use when:
 * - background code needs one domain-level retrieval pipeline
 * - callers want chunk loading, semantic recall, rerank, and packing to stay together
 *
 * Returns:
 * - retrieved chunks, packed context, and debug metadata for one request
 */
export async function resolveCompletionKnowledge(
  args: ResolveCompletionKnowledgeArgs,
): Promise<ResolveCompletionKnowledgeResult> {
  const resolutionStart = performance.now()
  if (args.prefix.trim().length < args.minPrefixChars) {
    return {
      chunks: [],
      timings: buildSkippedKnowledgeTimings(resolutionStart),
    }
  }

  try {
    const query = buildKnowledgeSearchQuery(args.prefix)
    if (query.length === 0) {
      return {
        chunks: [],
        timings: buildSkippedKnowledgeTimings(resolutionStart),
      }
    }

    const loadChunksStart = performance.now()
    const documents = await listKnowledgeDocuments(args.defaultKnowledgeBaseId)
    const allChunkCount = documents.reduce(
      (total, document) => total + Number(document.metadata.chunkCount ?? 0),
      0,
    )
    const embeddedDocuments = documents.filter(document => {
      const embedding = document.embedding
      return embedding !== undefined && embedding.values.length > 0
    })
    const embeddedChunkCount = documents.reduce(
      (total, document) => {
        const embedding = document.embedding
        if (embedding === undefined || embedding.values.length === 0) {
          return total
        }
        return total + Number(document.metadata.chunkCount ?? 0)
      },
      0,
    )
    const loadChunksMs = Math.round(performance.now() - loadChunksStart)
    const queryEmbeddingStart = performance.now()
    const semanticResolution = await args.resolveSemanticQueryEmbedding(query, embeddedChunkCount)
    const queryEmbeddingMs = Math.round(performance.now() - queryEmbeddingStart)
    const candidateDocIds = selectKnowledgeDocumentIds({
      documents: embeddedDocuments,
      limit: args.knowledgeDocumentTopK,
      queryEmbedding: semanticResolution?.meta?.queryEmbedding,
    })
    const candidateChunks = await listKnowledgeChunksByDocumentIds(candidateDocIds)

    const searchStart = performance.now()
    const result = await searchKnowledgeChunks({
      chunks: candidateChunks,
      kbId: args.defaultKnowledgeBaseId,
      query,
      topK: args.budget.topK,
      semanticMeta: semanticResolution?.meta,
    })
    const searchMs = Math.round(performance.now() - searchStart)
    const contextStart = performance.now()
    const packedKnowledge = buildKnowledgeContextProjection({
      chunks: result.chunks,
      maxChars: args.budget.maxChars,
      maxChunks: args.budget.topK,
    })
    const contextMs = Math.round(performance.now() - contextStart)
    const timings = {
      totalMs: Math.round(performance.now() - resolutionStart),
      loadChunksMs,
      queryEmbeddingMs,
      searchMs,
      contextMs,
      allChunkCount,
      embeddedChunkCount,
      semanticState: semanticResolution?.state ?? 'skipped',
    }

    if (packedKnowledge.context.length > 0) {
      return {
        chunks: result.chunks,
        context: packedKnowledge.context,
        budgetMeta: packedKnowledge.meta,
        query,
        recall: result.recall,
        rerank: result.rerank,
        timings,
      }
    }

    return {
      chunks: result.chunks,
      budgetMeta: packedKnowledge.meta,
      query,
      recall: result.recall,
      rerank: result.rerank,
      timings,
    }
  }
  catch (error) {
    console.warn('[copycat] knowledge retrieval skipped', error)
  }

  return {
    chunks: [],
    timings: buildSkippedKnowledgeTimings(resolutionStart),
  }
}

/**
 * Merges any caller-provided context with packed knowledge context.
 *
 * Use when:
 * - completion orchestration already has optional non-RAG context
 * - knowledge context should be appended without leaking empty blocks
 *
 * Returns:
 * - the merged context string, or `undefined` when nothing is present
 */
export function mergeCompletionContext(
  baseContext: string | undefined,
  knowledgeContext: string | undefined,
): string | undefined {
  const parts = [baseContext, knowledgeContext]
    .filter((part): part is string => part !== undefined && part.trim().length > 0)
    .map(part => part.trim())

  return parts.length > 0 ? parts.join('\n\n') : undefined
}

function buildSkippedKnowledgeTimings(
  resolutionStart: number,
): NonNullable<ResolveCompletionKnowledgeResult['timings']> {
  return {
    totalMs: Math.round(performance.now() - resolutionStart),
    loadChunksMs: 0,
    queryEmbeddingMs: 0,
    searchMs: 0,
    contextMs: 0,
    allChunkCount: 0,
    embeddedChunkCount: 0,
    semanticState: 'skipped',
  }
}

function selectKnowledgeDocumentIds(args: {
  documents: KnowledgeDocument[]
  limit: number
  queryEmbedding?: number[]
}): string[] {
  if (args.queryEmbedding === undefined) {
    return []
  }

  return args.documents
    .map((document) => {
      const score = resolveSemanticSimilarity(document.embedding?.values, args.queryEmbedding)
      return {
        document,
        score: score === null ? -1 : score,
      }
    })
    .filter(item => item.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score
      }
      return right.document.updatedAt - left.document.updatedAt
    })
    .slice(0, args.limit)
    .map(item => item.document.id)
}
