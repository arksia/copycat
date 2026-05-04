import type { CompletionResponse } from '~/types'
import { describe, expect, it } from 'vitest'
import {
  buildStageActivityLines,
  shouldPreferEnhancedCompletion,
  shouldRequestEnhancedStage,
  summarizeEnhancedOutcome,
} from '~/utils/completion/staging'

function buildResponse(partial: Partial<CompletionResponse>): CompletionResponse {
  return {
    id: 'req-1',
    completion: '',
    latencyMs: 0,
    provider: 'custom',
    model: 'test-model',
    stage: 'fast',
    shouldRunEnhancedStage: false,
    ...partial,
  }
}

describe('shouldRequestEnhancedStage', () => {
  it('requests the second stage only for fast responses that ask for it', () => {
    expect(shouldRequestEnhancedStage(buildResponse({
      stage: 'fast',
      shouldRunEnhancedStage: true,
    }))).toBe(true)

    expect(shouldRequestEnhancedStage(buildResponse({
      stage: 'fast',
      shouldRunEnhancedStage: false,
    }))).toBe(false)

    expect(shouldRequestEnhancedStage(buildResponse({
      stage: 'enhanced',
      shouldRunEnhancedStage: true,
    }))).toBe(false)
  })
})

describe('shouldPreferEnhancedCompletion', () => {
  it('prefers a non-empty enhanced completion when the fast stage had no suggestion', () => {
    expect(shouldPreferEnhancedCompletion('', '，支持评论功能。')).toBe(true)
  })

  it('prefers a different enhanced completion when it is at least as informative', () => {
    expect(shouldPreferEnhancedCompletion('，支持评论。', '，支持评论和标签管理。')).toBe(true)
  })

  it('keeps the current suggestion when the enhanced result is shorter or identical', () => {
    expect(shouldPreferEnhancedCompletion('，支持评论和标签管理。', '，支持评论。')).toBe(false)
    expect(shouldPreferEnhancedCompletion('，支持评论。', '，支持评论。')).toBe(false)
    expect(shouldPreferEnhancedCompletion('，支持评论。', '')).toBe(false)
  })
})

describe('summarizeEnhancedOutcome', () => {
  it('distinguishes skipped, replaced, and kept outcomes', () => {
    expect(summarizeEnhancedOutcome({
      triggered: false,
      replaced: false,
    })).toBe('skipped')

    expect(summarizeEnhancedOutcome({
      triggered: true,
      replaced: true,
    })).toBe('replaced')

    expect(summarizeEnhancedOutcome({
      triggered: true,
      replaced: false,
    })).toBe('kept_fast')
  })
})

describe('buildStageActivityLines', () => {
  it('builds a readable stage timeline', () => {
    expect(buildStageActivityLines({
      fastCompletion: '，支持评论。',
      shouldRunEnhancedStage: true,
      enhancedCompletion: '，支持评论和标签。',
      enhancedReplaced: true,
    })).toEqual([
      'fast: completed',
      'fast: requested enhanced follow-up',
      'enhanced: completed',
      'enhanced: replaced fast suggestion',
    ])
  })

  it('shows skipped enhanced stage clearly', () => {
    expect(buildStageActivityLines({
      fastCompletion: '',
      shouldRunEnhancedStage: false,
      enhancedCompletion: '',
      enhancedReplaced: false,
    })).toEqual([
      'fast: completed',
      'enhanced: not requested',
    ])
  })
})
