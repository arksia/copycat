import type { CompletionQualitySignal } from '~/utils/completion/telemetry'

/**
 * Retrieval budget used for one knowledge-grounded completion request.
 *
 * Use when:
 * - background code needs to decide how much local knowledge to retrieve
 * - later strategy work wants one explicit place for retrieval budget tuning
 *
 * Returns:
 * - the per-request top-K and packed context character budget
 */
export interface KnowledgeRetrievalBudget {
  topK: number
  maxChars: number
}

/**
 * Resolves the knowledge retrieval budget from base limits and an optional quality signal.
 *
 * Use when:
 * - default retrieval should stay conservative
 * - poor recent completion quality should justify a small knowledge boost
 *
 * Expects:
 * - base limits to represent the steady-state default budget
 *
 * Returns:
 * - a conservative default budget, or a slightly boosted budget when warranted
 */
export function resolveKnowledgeRetrievalBudget(args: {
  baseTopK: number
  baseMaxChars: number
  qualitySignal?: CompletionQualitySignal
}): KnowledgeRetrievalBudget {
  if (!args.qualitySignal?.shouldBoostKnowledge) {
    return {
      topK: args.baseTopK,
      maxChars: args.baseMaxChars,
    }
  }

  return {
    topK: args.baseTopK + 1,
    maxChars: args.baseMaxChars + 300,
  }
}
