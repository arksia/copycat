import type { CompletionEventStats } from '~/types'
import { describe, expect, it } from 'vitest'
import { deriveCompletionQualitySignal } from '~/utils/quality-signal'

function buildStats(partial: Partial<CompletionEventStats>): CompletionEventStats {
  return {
    total: 0,
    accepted: 0,
    rejected: 0,
    ignored: 0,
    acceptanceRate: 0,
    averageLatencyMs: 0,
    ...partial,
  }
}

describe('deriveCompletionQualitySignal', () => {
  it('marks sparse telemetry as insufficient data', () => {
    expect(deriveCompletionQualitySignal(buildStats({
      total: 3,
      accepted: 2,
      acceptanceRate: 0.67,
    }))).toEqual({
      band: 'insufficient_data',
      shouldBoostKnowledge: false,
      reason: 'Not enough local completion history yet.',
    })
  })

  it('marks strong acceptance as healthy', () => {
    expect(deriveCompletionQualitySignal(buildStats({
      total: 10,
      accepted: 7,
      rejected: 1,
      ignored: 2,
      acceptanceRate: 0.7,
      averageLatencyMs: 120,
    }))).toEqual({
      band: 'healthy',
      shouldBoostKnowledge: false,
      reason: 'Recent completions are being accepted consistently.',
    })
  })

  it('marks middling acceptance as mixed', () => {
    expect(deriveCompletionQualitySignal(buildStats({
      total: 10,
      accepted: 4,
      rejected: 3,
      ignored: 3,
      acceptanceRate: 0.4,
    }))).toEqual({
      band: 'mixed',
      shouldBoostKnowledge: false,
      reason: 'Recent completions are inconsistent and may need closer review.',
    })
  })

  it('marks weak acceptance as poor and recommends boosting knowledge', () => {
    expect(deriveCompletionQualitySignal(buildStats({
      total: 12,
      accepted: 2,
      rejected: 6,
      ignored: 4,
      acceptanceRate: 0.17,
    }))).toEqual({
      band: 'poor',
      shouldBoostKnowledge: true,
      reason: 'Recent completions are often rejected or ignored.',
    })
  })
})
