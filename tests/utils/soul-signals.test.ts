import { describe, expect, it } from 'vitest'
import { deriveSoulObservedSignals } from '~/soul'

describe('deriveSoulObservedSignals', () => {
  it('extracts direct answer-first preference tags from accepted completions', () => {
    const tags = deriveSoulObservedSignals({
      event: {
        id: 'evt-1',
        prefix: '写一个结论先行的回复',
        suggestion: '先给结论，再补充原因。',
        action: 'accepted',
        latencyMs: 120,
        timestamp: 100,
        host: 'chatgpt.com',
      },
    })

    expect(tags.map(tag => `${tag.kind}:${tag.value}`)).toEqual([
      'structure:answer-first',
      'preference:prefer-direct-tone',
    ])
  })

  it('extracts marketing avoidance tags from hype-heavy wording', () => {
    const tags = deriveSoulObservedSignals({
      event: {
        id: 'evt-2',
        prefix: '写一个产品描述',
        suggestion: 'Amazing and powerful results for every team!',
        action: 'rejected',
        latencyMs: 140,
        timestamp: 200,
        host: 'chatgpt.com',
      },
    })

    expect(tags.map(tag => `${tag.kind}:${tag.value}`)).toContain(
      'avoidance:avoid-marketing-language',
    )
  })

  it('extracts repeated english terms shared by prefix and suggestion', () => {
    const tags = deriveSoulObservedSignals({
      event: {
        id: 'evt-3',
        prefix: 'Explain the rag retrieval tradeoff',
        suggestion: 'RAG retrieval should stay local for small personal datasets.',
        action: 'accepted',
        latencyMs: 100,
        timestamp: 300,
        host: 'chatgpt.com',
      },
    })

    expect(tags.map(tag => `${tag.kind}:${tag.value}`)).toContain('term:term:rag')
    expect(tags.map(tag => `${tag.kind}:${tag.value}`)).toContain('term:term:retrieval')
  })
})
