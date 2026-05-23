import type { CompletionDebugInfo, KnowledgeChunk } from '~/types'

/**
 * Retrieval input for ranking knowledge chunks against a query.
 *
 * Use when:
 * - the caller already has candidate chunks in memory
 * - semantic ranking should stay local and deterministic
 *
 * Expects:
 * - `query` to contain the user-visible prompt fragment to ground against
 *
 * Returns:
 * - the retrieval query and ranking budget
 */
export interface RetrieveKnowledgeArgs {
  chunks: KnowledgeChunk[]
  query: string
  topK: number
  semantic?: {
    enabled: boolean
    queryEmbedding?: number[]
  }
}

interface KnowledgeChunkScore {
  semanticScore: number | null
  totalScore: number
}

export interface RetrieveKnowledgeResult {
  chunks: KnowledgeChunk[]
  rerank: NonNullable<CompletionDebugInfo['knowledgeRerank']>
}

/**
 * Ranks knowledge chunks against one query using semantic similarity.
 *
 * Before:
 * - chunks with unrelated terms mixed together
 *
 * After:
 * - top-K chunks ordered by semantic relevance to the query, plus rerank debug metadata
 */
export function retrieveKnowledge(args: RetrieveKnowledgeArgs): RetrieveKnowledgeResult {
  if (args.semantic?.queryEmbedding === undefined) {
    return {
      chunks: [],
      rerank: {
        strategy: 'semantic_only_v1',
        semanticEnabled: false,
        rankedChunks: [],
      },
    }
  }

  const rankedChunks = args.chunks
    .map(chunk => ({ chunk, score: scoreKnowledgeChunk(chunk, args.semantic?.queryEmbedding) }))
    .filter(item => item.score.totalScore > 0)
    .sort((left, right) => {
      if (right.score.totalScore !== left.score.totalScore) {
        return right.score.totalScore - left.score.totalScore
      }
      if (left.chunk.metadata.tokenCount !== right.chunk.metadata.tokenCount) {
        return left.chunk.metadata.tokenCount - right.chunk.metadata.tokenCount
      }
      return left.chunk.metadata.charCount - right.chunk.metadata.charCount
    })
  const selectedChunks = rankedChunks
    .slice(0, args.topK)
    .map(item => item.chunk)

  return {
    chunks: selectedChunks,
    rerank: {
      strategy: 'semantic_only_v1',
      semanticEnabled: args.semantic?.enabled === true,
      rankedChunks: rankedChunks.map(item => ({
        id: item.chunk.id,
        sourceName: item.chunk.metadata.sourceName,
        totalScore: item.score.totalScore,
        semanticScore: item.score.semanticScore,
        tokenCount: item.chunk.metadata.tokenCount,
        charCount: item.chunk.metadata.charCount,
      })),
    },
  }
}

function scoreKnowledgeChunk(
  chunk: KnowledgeChunk,
  queryEmbedding?: number[],
): KnowledgeChunkScore {
  const semanticScore = resolveSemanticSimilarity(chunk.embedding?.values, queryEmbedding)
  const totalScore = semanticScore === null ? 0 : Math.max(0, semanticScore)

  return {
    semanticScore,
    totalScore,
  }
}

export function resolveSemanticSimilarity(
  chunkEmbedding: number[] | undefined,
  queryEmbedding: number[] | undefined,
): number | null {
  if (!chunkEmbedding || !queryEmbedding) {
    return null
  }
  if (chunkEmbedding.length === 0 || chunkEmbedding.length !== queryEmbedding.length) {
    return null
  }

  let dot = 0
  let chunkNorm = 0
  let queryNorm = 0

  for (let index = 0; index < chunkEmbedding.length; index += 1) {
    const chunkValue = chunkEmbedding[index] ?? 0
    const queryValue = queryEmbedding[index] ?? 0
    dot += chunkValue * queryValue
    chunkNorm += chunkValue * chunkValue
    queryNorm += queryValue * queryValue
  }

  if (chunkNorm === 0 || queryNorm === 0) {
    return null
  }

  return dot / (Math.sqrt(chunkNorm) * Math.sqrt(queryNorm))
}
