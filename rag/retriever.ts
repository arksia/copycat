import type { CompletionDebugInfo, KnowledgeChunk } from '~/types'
import { extractKnowledgeKeywords } from './chunker'

/**
 * Retrieval input for ranking knowledge chunks against a query.
 *
 * Use when:
 * - the caller already has candidate chunks in memory
 * - a lightweight keyword-first retrieval pass is sufficient
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
  lexicalScore: number
  semanticScore: number | null
  totalScore: number
  matchedTerms: number
  keywordHits: number
  textHits: number
}

export interface RetrieveKnowledgeResult {
  chunks: KnowledgeChunk[]
  rerank: NonNullable<CompletionDebugInfo['knowledgeRerank']>
}

/**
 * Ranks knowledge chunks against one query using lightweight keyword overlap.
 *
 * Before:
 * - chunks with unrelated terms mixed together
 *
 * After:
 * - top-K chunks ordered by lexical relevance to the query, plus rerank debug metadata
 */
export function retrieveKnowledge(args: RetrieveKnowledgeArgs): RetrieveKnowledgeResult {
  const queryTerms = extractKnowledgeKeywords(args.query)
  if (args.semantic?.queryEmbedding === undefined) {
    return {
      chunks: [],
      rerank: {
        strategy: 'semantic_only_v1',
        semanticEnabled: false,
        queryTerms,
        rankedChunks: [],
      },
    }
  }

  const rankedChunks = args.chunks
    .map(chunk => ({ chunk, score: scoreKnowledgeChunk(chunk, queryTerms, args.semantic?.queryEmbedding) }))
    .filter(item => item.score.totalScore > 0)
    .sort((left, right) => {
      if (right.score.totalScore !== left.score.totalScore) {
        return right.score.totalScore - left.score.totalScore
      }
      if (right.score.matchedTerms !== left.score.matchedTerms) {
        return right.score.matchedTerms - left.score.matchedTerms
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
      queryTerms,
      rankedChunks: rankedChunks.map(item => ({
        id: item.chunk.id,
        sourceName: item.chunk.metadata.sourceName,
        totalScore: item.score.totalScore,
        lexicalScore: item.score.lexicalScore,
        semanticScore: item.score.semanticScore,
        matchedTerms: item.score.matchedTerms,
        keywordHits: item.score.keywordHits,
        textHits: item.score.textHits,
        tokenCount: item.chunk.metadata.tokenCount,
        charCount: item.chunk.metadata.charCount,
      })),
    },
  }
}

function scoreKnowledgeChunk(
  chunk: KnowledgeChunk,
  queryTerms: string[],
  queryEmbedding?: number[],
): KnowledgeChunkScore {
  const keywordSet = new Set(chunk.keywords)
  let lexicalScore = 0
  let matchedTerms = 0
  let keywordHits = 0
  let textHits = 0

  for (const term of queryTerms) {
    if (keywordSet.has(term)) {
      lexicalScore += term.length >= 4 ? 3 : 2
      matchedTerms += 1
      keywordHits += 1
      continue
    }
    if (chunk.text.toLowerCase().includes(term)) {
      lexicalScore += 1
      matchedTerms += 1
      textHits += 1
    }
  }

  const semanticScore = resolveSemanticSimilarity(chunk.embedding?.values, queryEmbedding)
  const totalScore = semanticScore === null ? 0 : Math.max(0, semanticScore)

  return {
    lexicalScore,
    semanticScore,
    totalScore,
    matchedTerms,
    keywordHits,
    textHits,
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
