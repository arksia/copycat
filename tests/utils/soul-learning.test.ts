import type { CompletionEvent } from '~/types'
import { describe, expect, it } from 'vitest'
import {
  buildSoulLearningPrompt,
  parseSoulLearningResponse,
  shouldRunSoulLearning,
} from '~/soul'

function buildEvent(overrides: Partial<CompletionEvent> = {}): CompletionEvent {
  return {
    id: overrides.id ?? 'evt-1',
    prefix: overrides.prefix ?? '请直接给一个工程实现建议',
    suggestion: overrides.suggestion ?? '先给结论，再列出取舍。',
    action: overrides.action ?? 'accepted',
    latencyMs: overrides.latencyMs ?? 120,
    timestamp: overrides.timestamp ?? 100,
    host: overrides.host ?? 'chatgpt.com',
  }
}

describe('shouldRunSoulLearning', () => {
  it('waits for enough events and actionable feedback outside the cooldown window', () => {
    const events = [
      buildEvent({ id: 'evt-1', action: 'accepted' }),
      buildEvent({ id: 'evt-2', action: 'accepted' }),
      buildEvent({ id: 'evt-3', action: 'rejected' }),
      buildEvent({ id: 'evt-4', action: 'ignored' }),
      buildEvent({ id: 'evt-5', action: 'ignored' }),
      buildEvent({ id: 'evt-6', action: 'ignored' }),
    ]

    expect(shouldRunSoulLearning({
      cooldownMs: 100,
      events,
      lastRunAt: 0,
      now: 200,
    })).toBe(true)
  })

  it('does not run during cooldown or without enough actionable feedback', () => {
    const events = Array.from({ length: 6 }, (_, index) => buildEvent({
      id: `evt-${index}`,
      action: index === 0 ? 'accepted' : 'ignored',
    }))

    expect(shouldRunSoulLearning({
      cooldownMs: 100,
      events,
      lastRunAt: 150,
      now: 200,
    })).toBe(false)

    expect(shouldRunSoulLearning({
      cooldownMs: 100,
      events,
      lastRunAt: 0,
      now: 200,
    })).toBe(false)
  })
})

describe('buildSoulLearningPrompt', () => {
  it('builds a model prompt from the current Soul text and recent events', () => {
    const prompt = buildSoulLearningPrompt({
      currentSoulText: '保持直接，先给结论。',
      events: [
        buildEvent({
          action: 'accepted',
          prefix: '帮我写一个方案',
          suggestion: '先给结论，再说明原因。',
        }),
      ],
    })

    expect(prompt).toContain('[Current Soul Text]\n保持直接，先给结论。')
    expect(prompt).toContain('"action":"accepted"')
    expect(prompt).toContain('"prefix":"帮我写一个方案"')
    expect(prompt).toContain('"nextSoulText"')
  })
})

describe('parseSoulLearningResponse', () => {
  it('parses a valid fenced model response', () => {
    const result = parseSoulLearningResponse(
      '```json\n{"shouldUpdate":true,"nextSoulText":"  保持直接\\n先给结论  ","reason":"repeated accepted events"}\n```',
      '旧 Soul',
    )

    expect(result).toEqual({
      shouldUpdate: true,
      nextSoulText: '保持直接\n先给结论',
      reason: 'repeated accepted events',
    })
  })

  it('returns the current Soul text when the model decides not to update', () => {
    expect(parseSoulLearningResponse(
      '{"shouldUpdate":false,"nextSoulText":"ignored","reason":"not enough evidence"}',
      '当前 Soul',
    )).toEqual({
      shouldUpdate: false,
      nextSoulText: '当前 Soul',
      reason: 'not enough evidence',
    })
  })

  it('rejects invalid or empty update responses', () => {
    expect(parseSoulLearningResponse('not json', '当前 Soul')).toBeNull()
    expect(parseSoulLearningResponse(
      '{"shouldUpdate":true,"nextSoulText":"当前 Soul","reason":"same"}',
      '当前 Soul',
    )).toBeNull()
  })
})
