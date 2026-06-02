import { describe, expect, it } from 'vitest'
import {
  createCompletionTriggerMemory,
  evaluateCompletionTrigger,
} from '~/utils/completion/trigger'

describe('evaluateCompletionTrigger', () => {
  it('allows the first request', () => {
    expect(evaluateCompletionTrigger({
      prefix: '我觉得这个问题',
      now: 1000,
      memory: createCompletionTriggerMemory(),
    })).toEqual({ allowed: true })
  })

  it('requires enough delta before retrying', () => {
    const memory = createCompletionTriggerMemory()
    memory.lastRequestedPrefix = '我觉得这个问题'

    expect(evaluateCompletionTrigger({
      prefix: '我觉得这个问题很',
      now: 1000,
      memory,
    })).toEqual({ allowed: false, reason: 'delta' })

    expect(evaluateCompletionTrigger({
      prefix: '我觉得这个问题很关键',
      now: 1000,
      memory,
    })).toEqual({ allowed: true })
  })

  it('blocks the same prefix from re-requesting', () => {
    const memory = createCompletionTriggerMemory()
    memory.lastRequestedPrefix = '我觉得这个问题'

    expect(evaluateCompletionTrigger({
      prefix: '我觉得这个问题',
      now: 1000,
      memory,
    })).toEqual({
      allowed: false,
      reason: 'delta',
    })
  })

  it('allows a request after enough deletion (backspace)', () => {
    const memory = createCompletionTriggerMemory()
    memory.lastRequestedPrefix = '我觉得这个问题'

    expect(evaluateCompletionTrigger({
      prefix: '我觉得这个问',
      now: 1000,
      memory,
    })).toEqual({ allowed: false, reason: 'delta' })

    expect(evaluateCompletionTrigger({
      prefix: '我觉得这',
      now: 1000,
      memory,
    })).toEqual({ allowed: true })
  })

  it('requires a larger delta after a skip while still in cooldown', () => {
    const memory = createCompletionTriggerMemory()
    memory.lastRequestedPrefix = '你觉得这个方案怎么样？'
    memory.lastSkipPrefix = '你觉得这个方案怎么样？'
    memory.lastSkipAt = 1000

    expect(evaluateCompletionTrigger({
      prefix: '你觉得这个方案怎么样？如',
      now: 2000,
      memory,
    })).toEqual({
      allowed: false,
      reason: 'skip_cooldown',
    })

    expect(evaluateCompletionTrigger({
      prefix: '你觉得这个方案怎么样？如果',
      now: 2000,
      memory,
    })).toEqual({ allowed: true })
  })

  it('retries the same skipped prefix after cooldown', () => {
    const memory = createCompletionTriggerMemory()
    memory.lastSkipPrefix = '请帮我总结一下这个 PR。'
    memory.lastSkipAt = 1000

    expect(evaluateCompletionTrigger({
      prefix: '请帮我总结一下这个 PR。',
      now: 3000,
      memory,
    })).toEqual({ allowed: true })
  })

  it('does not require request timestamps to evaluate cooldown and retry thresholds', () => {
    const memory = createCompletionTriggerMemory()
    memory.lastRequestedPrefix = '我觉得这个问题'
    memory.lastSkipPrefix = '你觉得这个方案怎么样？'
    memory.lastSkipAt = 1000

    expect(memory).not.toHaveProperty('lastRequestAt')
    expect(evaluateCompletionTrigger({
      prefix: '你觉得这个方案怎么样？如果我们还要',
      now: 2000,
      memory,
    })).toEqual({ allowed: true })
  })

  it('allows a rewritten prefix immediately when it is no longer an extension of the last request', () => {
    const memory = createCompletionTriggerMemory()
    memory.lastRequestedPrefix = '我觉得这个问题'

    expect(evaluateCompletionTrigger({
      prefix: '我觉得这个方案',
      now: 1000,
      memory,
    })).toEqual({ allowed: true })
  })

  it('allows a rewritten prefix immediately when it is no longer an extension of the last skipped prefix', () => {
    const memory = createCompletionTriggerMemory()
    memory.lastSkipPrefix = '请帮我总结一下这个 PR。'
    memory.lastSkipAt = 1000

    expect(evaluateCompletionTrigger({
      prefix: '请帮我总结一下这个 issue。',
      now: 1200,
      memory,
    })).toEqual({ allowed: true })
  })
})
