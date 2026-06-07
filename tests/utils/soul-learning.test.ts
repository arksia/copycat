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
    actualContinuation: overrides.actualContinuation ?? (overrides.suggestion ?? '先给结论，再列出取舍。'),
    action: overrides.action ?? 'accepted',
    latencyMs: overrides.latencyMs ?? 120,
    timestamp: overrides.timestamp ?? 100,
    host: overrides.host ?? 'chatgpt.com',
  }
}

describe('shouldRunSoulLearning', () => {
  it('waits for enough fresh events outside the cooldown window', () => {
    const events = Array.from({ length: 12 }, (_, index) => buildEvent({
      id: `evt-${index + 1}`,
      action: index % 3 === 0 ? 'rejected' : 'accepted',
      actualContinuation: index % 3 === 0 ? '换一种更直接的说法。' : '先给结论，再列出取舍。',
      timestamp: 100 + index,
    }))

    expect(shouldRunSoulLearning({
      cooldownMs: 100,
      events,
      lastRunAt: 0,
      now: 200,
    })).toBe(true)
  })

  it('does not run during cooldown or without enough fresh events', () => {
    const events = Array.from({ length: 11 }, (_, index) => buildEvent({
      id: `evt-${index + 1}`,
      action: index % 2 === 0 ? 'accepted' : 'rejected',
      actualContinuation: index % 2 === 0 ? '先给结论，再列出取舍。' : '先说风险，再给建议。',
      timestamp: 100 + index,
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

    expect(shouldRunSoulLearning({
      cooldownMs: 100,
      events: [
        ...events,
        buildEvent({
          id: 'evt-12',
          timestamp: 100,
        }),
      ],
      lastRunAt: 100,
      now: 250,
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
          actualContinuation: '先给结论，再说明原因。',
        }),
        buildEvent({
          action: 'rejected',
          prefix: '帮我写一个方案',
          suggestion: '补一个长背景段落。',
          actualContinuation: '直接列实现步骤。',
        }),
      ],
    })

    expect(prompt).toContain('[Current Soul Text]\n保持直接，先给结论。')
    expect(prompt).toContain('[Recent Accepted Events]')
    expect(prompt).toContain('[Recent Rejected Events]')
    expect(prompt).toContain('"action":"accepted"')
    expect(prompt).toContain('"action":"rejected"')
    expect(prompt).toContain('"prefix":"帮我写一个方案"')
    expect(prompt).toContain('"actualContinuation":"直接列实现步骤。"')
    expect(prompt).toContain('Treat rejected events as evidence that the suggestion pattern was wrong')
    expect(prompt).toContain('"nextSoulText"')
  })

  it('deduplicates repeated events and caps each action bucket', () => {
    const prompt = buildSoulLearningPrompt({
      currentSoulText: '保持直接。',
      events: [
        ...Array.from({ length: 10 }, (_, index) => buildEvent({
          id: `accepted-dup-${index}`,
          action: 'accepted',
          prefix: '帮我写方案',
          suggestion: '先给结论。',
          actualContinuation: '先给结论。',
          timestamp: 200 - index,
        })),
        ...Array.from({ length: 10 }, (_, index) => buildEvent({
          id: `rejected-${index}`,
          action: 'rejected',
          prefix: `帮我写方案 ${index}`,
          suggestion: '先写长背景。',
          actualContinuation: `直接列步骤 ${index}`,
          timestamp: 100 - index,
        })),
      ],
    })

    expect(prompt.match(/"action":"accepted"/g)?.length).toBe(1)
    expect(prompt.match(/"action":"rejected"/g)?.length).toBe(8)
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
