import type { CompletionQualitySignal } from '~/utils/quality-signal'
import { describe, expect, it } from 'vitest'
import { resolveKnowledgeRetrievalBudget } from '~/utils/knowledge-budget'

function buildSignal(partial: Partial<CompletionQualitySignal>): CompletionQualitySignal {
  return {
    band: 'healthy',
    shouldBoostKnowledge: false,
    reason: 'default',
    ...partial,
  }
}

describe('resolveKnowledgeRetrievalBudget', () => {
  it('keeps defaults when there is no signal', () => {
    expect(resolveKnowledgeRetrievalBudget({
      baseTopK: 2,
      baseMaxChars: 900,
    })).toEqual({
      topK: 2,
      maxChars: 900,
    })
  })

  it('keeps defaults for healthy or mixed quality', () => {
    expect(resolveKnowledgeRetrievalBudget({
      baseTopK: 2,
      baseMaxChars: 900,
      qualitySignal: buildSignal({
        band: 'mixed',
        shouldBoostKnowledge: false,
      }),
    })).toEqual({
      topK: 2,
      maxChars: 900,
    })
  })

  it('boosts retrieval budget when the signal recommends more knowledge', () => {
    expect(resolveKnowledgeRetrievalBudget({
      baseTopK: 2,
      baseMaxChars: 900,
      qualitySignal: buildSignal({
        band: 'poor',
        shouldBoostKnowledge: true,
      }),
    })).toEqual({
      topK: 3,
      maxChars: 1200,
    })
  })
})
