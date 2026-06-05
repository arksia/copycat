import type { SoulObservedSignal } from '~/types'
import { describe, expect, it } from 'vitest'
import { distillSoulSignals } from '~/soul'

function buildSignal(overrides: Partial<SoulObservedSignal> & Pick<SoulObservedSignal, 'id' | 'kind' | 'value'>): SoulObservedSignal {
  return {
    id: overrides.id,
    kind: overrides.kind,
    value: overrides.value,
    confidence: overrides.confidence ?? 0.8,
    count: overrides.count ?? 3,
    acceptedCount: overrides.acceptedCount ?? 2,
    rejectedCount: overrides.rejectedCount ?? 0,
    ignoredCount: overrides.ignoredCount ?? 1,
    distinctContextCount: overrides.distinctContextCount ?? 2,
    firstSeenAt: overrides.firstSeenAt ?? 100,
    lastSeenAt: overrides.lastSeenAt ?? 200,
    evidence: overrides.evidence ?? {
      action: 'accepted',
      host: 'chatgpt.com',
      prefixPreview: '',
      suggestionPreview: '',
      suggestionLengthBucket: 'short',
      openingStructure: 'answer-first',
      toneHints: [],
      termHits: [],
      timestamp: 200,
    },
    contextKeys: overrides.contextKeys ?? ['a', 'b'],
    documentIds: overrides.documentIds ?? [],
  }
}

describe('distillSoulSignals', () => {
  it('distills observed preferences, avoidances, and terms from mature signals', () => {
    const result = distillSoulSignals([
      buildSignal({
        id: 'signal-1',
        kind: 'preference',
        value: 'prefer-direct-tone',
      }),
      buildSignal({
        id: 'signal-2',
        kind: 'avoidance',
        value: 'avoid-marketing-language',
      }),
      buildSignal({
        id: 'signal-3',
        kind: 'term',
        value: 'term:rag',
      }),
    ])

    expect(result.profile).toEqual({
      preferences: ['Lead with the answer when it fits naturally.'],
      avoidances: ['Avoid hype, promotional language, and exaggerated claims.'],
      terms: ['rag'],
    })
    expect(result.cues).toHaveLength(3)
  })

  it('deduplicates repeated observed values', () => {
    const result = distillSoulSignals([
      buildSignal({
        id: 'signal-1',
        kind: 'term',
        value: 'term:rag',
      }),
      buildSignal({
        id: 'signal-2',
        kind: 'term',
        value: 'term:rag',
      }),
    ])

    expect(result.profile.terms).toEqual(['rag'])
  })

  it('distills observed structure signals into observed preferences', () => {
    const result = distillSoulSignals([
      buildSignal({
        id: 'signal-1',
        kind: 'structure',
        value: 'list-first',
      }),
      buildSignal({
        id: 'signal-2',
        kind: 'structure',
        value: 'context-first',
      }),
    ])

    expect(result.profile.preferences).toEqual([
      'Use a list-first structure when the prefix asks for multiple items.',
      'Add brief context before the answer when setup matters.',
    ])
    expect(result.cues).toHaveLength(2)
  })
})
