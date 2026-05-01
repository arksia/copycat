import type { CompletionEvent, CompletionEventStats } from '~/types'
import { describe, expect, it, vi } from 'vitest'
import { loadTelemetrySnapshot } from '~/utils/telemetry'

describe('loadTelemetrySnapshot', () => {
  it('returns telemetry data when both loaders succeed', async () => {
    const stats: CompletionEventStats = {
      total: 3,
      accepted: 2,
      rejected: 1,
      ignored: 0,
      acceptanceRate: 0.67,
      averageLatencyMs: 127,
    }
    const events: CompletionEvent[] = [
      {
        id: 'evt-1',
        prefix: '我需要构建一个博客系统',
        suggestion: '，支持评论功能。',
        action: 'accepted',
        latencyMs: 120,
        timestamp: 100,
        host: 'chatgpt.com',
      },
    ]

    expect(await loadTelemetrySnapshot({
      host: 'chatgpt.com',
      loadStats: vi.fn().mockResolvedValue(stats),
      loadEvents: vi.fn().mockResolvedValue(events),
    })).toEqual({
      stats,
      events,
      error: '',
    })
  })

  it('returns an empty snapshot when telemetry loading fails', async () => {
    expect(await loadTelemetrySnapshot({
      host: 'chatgpt.com',
      loadStats: vi.fn().mockRejectedValue(new Error('IndexedDB blocked')),
      loadEvents: vi.fn(),
    })).toEqual({
      stats: null,
      events: [],
      error: 'IndexedDB blocked',
    })
  })

  it('returns an empty snapshot when no host is available', async () => {
    expect(await loadTelemetrySnapshot({
      host: '',
      loadStats: vi.fn(),
      loadEvents: vi.fn(),
    })).toEqual({
      stats: null,
      events: [],
      error: '',
    })
  })
})
