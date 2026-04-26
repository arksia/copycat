import type { KnowledgeChunk } from '~/types'
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
}

/**
 * Ranks knowledge chunks against one query using lightweight keyword overlap.
 *
 * Before:
 * - chunks with unrelated terms mixed together
 *
 * After:
 * - top-K chunks ordered by lexical relevance to the query
 */
export function retrieveKnowledge(args: RetrieveKnowledgeArgs): KnowledgeChunk[] {
  const queryTerms = extractKnowledgeKeywords(args.query)
  if (queryTerms.length === 0) {
    return []
  }

  return args.chunks
    .map(chunk => ({ chunk, score: scoreKnowledgeChunk(chunk, queryTerms) }))
    .filter(item => item.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score
      }
      return right.chunk.metadata.tokenCount - left.chunk.metadata.tokenCount
    })
    .slice(0, args.topK)
    .map(item => item.chunk)
}

function scoreKnowledgeChunk(chunk: KnowledgeChunk, queryTerms: string[]): number {
  const keywordSet = new Set(chunk.keywords)
  let score = 0

  for (const term of queryTerms) {
    if (keywordSet.has(term)) {
      score += term.length >= 4 ? 3 : 2
      continue
    }
    if (chunk.text.toLowerCase().includes(term)) {
      score += 1
    }
  }

  return score
}
