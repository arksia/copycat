import type { CompletionEvent, SoulObservedSignal } from '~/types'
import { afterEach, describe, expect, it } from 'vitest'
import { deleteCopycatDb } from '~/utils/db/client'
import {
  getPersistedCompletion,
  putPersistedCompletion,
} from '~/utils/db/repositories/completions'
import {
  getCompletionEventStats,
  listRecentCompletionEventsByHost,
  putCompletionEvent,
} from '~/utils/db/repositories/events'
import {
  listKnowledgeDocuments,
  listKnowledgeChunksByDocumentIds,
  putKnowledgeChunks,
  putKnowledgeDocument,
  searchKnowledgeChunks,
} from '~/rag'
import {
  getSoulObservedSignalSnapshot,
  listSoulObservedSignals,
  putSoulObservedSignal,
  upsertSoulObservedSignal,
} from '~/soul'

afterEach(async () => {
  await deleteCopycatDb()
})

describe('indexeddb repositories', () => {
  it('stores and lists recent completion events for one host in reverse time order', async () => {
    const olderEvent: CompletionEvent = {
      id: 'evt-1',
      prefix: '我需要构建一个博客系统',
      suggestion: '，并且支持评论和标签。',
      action: 'accepted',
      latencyMs: 120,
      timestamp: 100,
      host: 'chatgpt.com',
    }
    const newerEvent: CompletionEvent = {
      id: 'evt-2',
      prefix: '我需要构建一个博客系统',
      suggestion: '，并支持管理后台。',
      action: 'ignored',
      latencyMs: 140,
      timestamp: 200,
      host: 'chatgpt.com',
    }
    const otherHostEvent: CompletionEvent = {
      id: 'evt-3',
      prefix: 'hello',
      suggestion: ' world',
      action: 'rejected',
      latencyMs: 80,
      timestamp: 300,
      host: 'claude.ai',
    }

    await putCompletionEvent(olderEvent)
    await putCompletionEvent(newerEvent)
    await putCompletionEvent(otherHostEvent)

    const events = await listRecentCompletionEventsByHost('chatgpt.com', 5)

    expect(events).toEqual([newerEvent, olderEvent])
  })

  it('aggregates completion event stats for one host', async () => {
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
      {
        id: 'evt-2',
        prefix: '我需要构建一个博客系统',
        suggestion: '，支持标签管理。',
        action: 'accepted',
        latencyMs: 180,
        timestamp: 200,
        host: 'chatgpt.com',
      },
      {
        id: 'evt-3',
        prefix: '我需要构建一个博客系统',
        suggestion: '，支持 RSS 订阅。',
        action: 'rejected',
        latencyMs: 80,
        timestamp: 300,
        host: 'chatgpt.com',
      },
      {
        id: 'evt-4',
        prefix: 'hello',
        suggestion: ' world',
        action: 'ignored',
        latencyMs: 60,
        timestamp: 400,
        host: 'claude.ai',
      },
    ]

    for (const event of events) {
      await putCompletionEvent(event)
    }

    expect(await getCompletionEventStats('chatgpt.com')).toEqual({
      total: 3,
      accepted: 2,
      rejected: 1,
      ignored: 0,
      acceptanceRate: 0.67,
      averageLatencyMs: 127,
    })
  })

  it('aggregates completion event stats from only the most recent window', async () => {
    const events: CompletionEvent[] = [
      {
        id: 'evt-1',
        prefix: 'old accepted',
        suggestion: ' old accepted',
        action: 'accepted',
        latencyMs: 100,
        timestamp: 100,
        host: 'chatgpt.com',
      },
      {
        id: 'evt-2',
        prefix: 'new rejected',
        suggestion: ' new rejected',
        action: 'rejected',
        latencyMs: 200,
        timestamp: 200,
        host: 'chatgpt.com',
      },
      {
        id: 'evt-3',
        prefix: 'new ignored',
        suggestion: ' new ignored',
        action: 'ignored',
        latencyMs: 300,
        timestamp: 300,
        host: 'chatgpt.com',
      },
    ]

    for (const event of events) {
      await putCompletionEvent(event)
    }

    expect(await getCompletionEventStats('chatgpt.com', 2)).toEqual({
      total: 2,
      accepted: 0,
      rejected: 1,
      ignored: 1,
      acceptanceRate: 0,
      averageLatencyMs: 250,
    })
  })

  it('returns persisted completions while fresh and evicts them after expiry', async () => {
    await putPersistedCompletion({
      key: 'cache-key',
      value: '，并带有标签系统。',
      expiresAt: 200,
      updatedAt: 100,
    })

    expect(await getPersistedCompletion('cache-key', 150)).toBe('，并带有标签系统。')
    expect(await getPersistedCompletion('cache-key', 250)).toBeNull()
    expect(await getPersistedCompletion('cache-key', 150)).toBeNull()
  })

  it('stores and lists observed Soul signals by recency', async () => {
    await putSoulObservedSignal({
      id: 'signal-1',
      kind: 'preference',
      value: 'prefer-direct-tone',
      confidence: 0.67,
      count: 3,
      acceptedCount: 2,
      rejectedCount: 1,
      ignoredCount: 0,
      distinctContextCount: 2,
      firstSeenAt: 100,
      lastSeenAt: 200,
      evidence: buildSoulSignalEvidence('accepted', 200),
      contextKeys: ['chatgpt.com::direct'],
      documentIds: [],
    })
    await putSoulObservedSignal({
      id: 'signal-2',
      kind: 'avoidance',
      value: 'avoid-marketing-language',
      confidence: 0.5,
      count: 2,
      acceptedCount: 0,
      rejectedCount: 1,
      ignoredCount: 1,
      distinctContextCount: 1,
      firstSeenAt: 50,
      lastSeenAt: 300,
      evidence: buildSoulSignalEvidence('rejected', 300),
      contextKeys: ['chatgpt.com::marketing'],
      documentIds: [],
    })

    const signals = await listSoulObservedSignals({ limit: 5 })

    expect(signals.map(signal => signal.id)).toEqual(['signal-2', 'signal-1'])
  })

  it('aggregates observed Soul signals across repeated matching events', async () => {
    await upsertSoulObservedSignal({
      kind: 'preference',
      value: 'prefer-direct-tone',
      evidence: buildSoulSignalEvidence('accepted', 100),
      contextKey: 'chatgpt.com::a',
      documentIds: [],
    })
    await upsertSoulObservedSignal({
      kind: 'preference',
      value: 'prefer-direct-tone',
      evidence: buildSoulSignalEvidence('accepted', 200),
      contextKey: 'chatgpt.com::b',
      documentIds: [],
    })
    await upsertSoulObservedSignal({
      kind: 'preference',
      value: 'prefer-direct-tone',
      evidence: buildSoulSignalEvidence('rejected', 300),
      contextKey: 'chatgpt.com::b',
      documentIds: [],
    })

    const snapshot = await getSoulObservedSignalSnapshot()

    expect(snapshot.totalCount).toBe(1)
    expect(snapshot.signals[0]).toEqual(expect.objectContaining({
      value: 'prefer-direct-tone',
      count: 3,
      acceptedCount: 2,
      rejectedCount: 1,
      distinctContextCount: 2,
      confidence: 0.43,
    }))
  })

  it('filters mature observed Soul signals using the v1 thresholds', async () => {
    await putSoulObservedSignal(buildStoredSoulSignal({
      id: 'signal-1',
      value: 'prefer-direct-tone',
      count: 3,
      acceptedCount: 2,
      rejectedCount: 0,
      ignoredCount: 1,
      distinctContextCount: 2,
      lastSeenAt: 200,
    }))
    await putSoulObservedSignal(buildStoredSoulSignal({
      id: 'signal-2',
      value: 'avoid-marketing-language',
      count: 2,
      acceptedCount: 0,
      rejectedCount: 1,
      ignoredCount: 1,
      distinctContextCount: 1,
      lastSeenAt: 300,
    }))

    const snapshot = await getSoulObservedSignalSnapshot({ matureOnly: true })

    expect(snapshot.totalCount).toBe(2)
    expect(snapshot.matureCount).toBe(1)
    expect(snapshot.signals.map(signal => signal.id)).toEqual(['signal-1'])
  })

  it('stores knowledge documents and searches chunks inside one knowledge base', async () => {
    await putKnowledgeDocument({
      id: 'doc-1',
      kbId: 'default',
      title: 'Virtual List Notes',
      sourceType: 'markdown',
      checksum: 'abc',
      embedding: {
        backend: 'wasm',
        embeddedAt: 100,
        model: 'test-model',
        values: [1, 0],
        version: 'test',
      },
      metadata: {
        chunkCount: 1,
        charCount: 22,
      },
      createdAt: 100,
      updatedAt: 100,
    })
    await putKnowledgeChunks([
      {
        id: 'chunk-1',
        kbId: 'default',
        docId: 'doc-1',
        text: '虚拟列表适合处理长列表渲染和滚动性能问题。',
        keywords: ['虚拟列表', '虚拟', '列表', '滚动', '性能'],
        embedding: {
          backend: 'wasm',
          embeddedAt: 100,
          model: 'test-model',
          values: [1, 0],
          version: 'test',
        },
        metadata: {
          charCount: 24,
          sourceName: 'Virtual List Notes',
          tokenCount: 14,
        },
      },
      {
        id: 'chunk-2',
        kbId: 'other',
        docId: 'doc-2',
        text: '这个 chunk 属于另一个知识库。',
        keywords: ['知识库'],
        embedding: {
          backend: 'wasm',
          embeddedAt: 100,
          model: 'test-model',
          values: [0, 1],
          version: 'test',
        },
        metadata: {
          charCount: 16,
          sourceName: 'Other',
          tokenCount: 8,
        },
      },
    ])

    expect(await listKnowledgeDocuments('default')).toEqual([
      expect.objectContaining({
        id: 'doc-1',
        title: 'Virtual List Notes',
        embedding: expect.objectContaining({
          model: 'test-model',
        }),
      }),
    ])

    const result = await searchKnowledgeChunks({
      kbId: 'default',
      query: '如何优化虚拟列表滚动性能',
      semanticMeta: {
        backend: 'wasm',
        latencyMs: 8,
        model: 'test-model',
        queryEmbedding: [1, 0],
      },
      topK: 2,
    })

    expect(result.chunks).toEqual([
      expect.objectContaining({ id: 'chunk-1' }),
    ])
    expect(result.recall).toEqual(expect.objectContaining({
      strategy: 'semantic_index',
      candidateCount: 1,
      returnedCount: 1,
    }))
    expect(result.recall.queryTerms).toEqual(expect.arrayContaining(['虚拟', '列表', '滚动', '性能']))
    expect(result.rerank).toEqual(expect.objectContaining({
      strategy: 'semantic_only_v1',
      semanticEnabled: true,
    }))
    expect(result.rerank.rankedChunks[0]).toEqual(expect.objectContaining({
      id: 'chunk-1',
      sourceName: 'Virtual List Notes',
    }))
    expect(await listKnowledgeChunksByDocumentIds(['doc-1'])).toEqual([
      expect.objectContaining({ id: 'chunk-1' }),
    ])
  })
})

function buildSoulSignalEvidence(
  action: CompletionEvent['action'],
  timestamp: number,
): SoulObservedSignal['evidence'] {
  return {
    action,
    host: 'chatgpt.com',
    prefixPreview: '写一个结论先行的说明',
    suggestionPreview: '先给结论，再补背景。',
    suggestionLengthBucket: 'short',
    openingStructure: 'answer-first',
    toneHints: ['direct'],
    termHits: [],
    timestamp,
  }
}

function buildStoredSoulSignal(
  overrides: Partial<SoulObservedSignal> & Pick<SoulObservedSignal, 'id' | 'value'>,
): SoulObservedSignal {
  return {
    id: overrides.id,
    kind: overrides.kind ?? 'preference',
    value: overrides.value,
    confidence: overrides.confidence ?? 0.67,
    count: overrides.count ?? 3,
    acceptedCount: overrides.acceptedCount ?? 2,
    rejectedCount: overrides.rejectedCount ?? 0,
    ignoredCount: overrides.ignoredCount ?? 1,
    distinctContextCount: overrides.distinctContextCount ?? 2,
    firstSeenAt: overrides.firstSeenAt ?? 100,
    lastSeenAt: overrides.lastSeenAt ?? 300,
    lastReflectedAt: overrides.lastReflectedAt,
    evidence: overrides.evidence ?? buildSoulSignalEvidence('accepted', overrides.lastSeenAt ?? 300),
    contextKeys: overrides.contextKeys ?? ['chatgpt.com::a', 'chatgpt.com::b'],
    documentIds: overrides.documentIds ?? [],
  }
}
