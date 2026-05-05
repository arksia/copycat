import type { KnowledgeChunk } from '~/types'
import { describe, expect, it } from 'vitest'
import { retrieveKnowledge } from '~/utils/knowledge/retriever'

describe('retrieveKnowledge', () => {
  it('prefers chunks with the strongest lexical overlap', () => {
    const chunks: KnowledgeChunk[] = [
      {
        id: 'a',
        kbId: 'default',
        docId: 'doc-1',
        text: '虚拟列表适合处理长列表滚动渲染。',
        keywords: ['虚拟列表', '虚拟', '列表', '滚动', '渲染'],
        metadata: { charCount: 16, sourceName: 'A', tokenCount: 12 },
      },
      {
        id: 'b',
        kbId: 'default',
        docId: 'doc-2',
        text: '博客系统需要评论、标签和后台管理。',
        keywords: ['博客系统', '评论', '标签', '后台'],
        metadata: { charCount: 16, sourceName: 'B', tokenCount: 10 },
      },
    ]

    const results = retrieveKnowledge({
      chunks,
      query: '如何用虚拟列表优化长列表渲染',
      topK: 1,
    })

    expect(results.chunks).toEqual([chunks[0]])
    expect(results.rerank).toEqual({
      strategy: 'lexical_v1',
      semanticEnabled: false,
      queryTerms: expect.arrayContaining(['虚拟', '列表', '渲染']),
      rankedChunks: [
        expect.objectContaining({
          id: 'a',
          sourceName: 'A',
          semanticScore: null,
        }),
      ],
    })
  })

  it('prefers the more focused chunk when overlap is otherwise similar', () => {
    const chunks: KnowledgeChunk[] = [
      {
        id: 'focused',
        kbId: 'default',
        docId: 'doc-1',
        text: 'virtual list performance',
        keywords: ['virtual', 'list', 'performance'],
        metadata: { charCount: 24, sourceName: 'Focused', tokenCount: 3 },
      },
      {
        id: 'noisy',
        kbId: 'default',
        docId: 'doc-2',
        text: 'virtual list performance with extra caching metrics background noise',
        keywords: ['virtual', 'list', 'performance', 'caching', 'metrics', 'background', 'noise'],
        metadata: { charCount: 68, sourceName: 'Noisy', tokenCount: 7 },
      },
    ]

    const results = retrieveKnowledge({
      chunks,
      query: 'virtual list performance',
      topK: 1,
    })

    expect(results.chunks).toEqual([chunks[0]])
    expect(results.rerank?.rankedChunks[0]).toEqual(expect.objectContaining({
      id: 'focused',
      lexicalScore: 9,
      totalScore: 9,
      matchedTerms: 3,
      keywordHits: 3,
      textHits: 0,
      tokenCount: 3,
      charCount: 24,
    }))
    expect(results.rerank?.rankedChunks[1]).toEqual(expect.objectContaining({
      id: 'noisy',
      lexicalScore: 9,
      totalScore: 9,
      matchedTerms: 3,
      keywordHits: 3,
      textHits: 0,
      tokenCount: 7,
      charCount: 68,
    }))
  })

  it('uses semantic score as a bounded boost when embeddings are available', () => {
    const chunks: KnowledgeChunk[] = [
      {
        id: 'lexical-lead',
        kbId: 'default',
        docId: 'doc-1',
        text: 'virtual list performance',
        keywords: ['virtual', 'list', 'performance'],
        embedding: {
          backend: 'wasm',
          embeddedAt: 100,
          model: 'test-model',
          values: [1, 0],
          version: 'test',
        },
        metadata: { charCount: 24, sourceName: 'Lexical', tokenCount: 3 },
      },
      {
        id: 'semantic-boosted',
        kbId: 'default',
        docId: 'doc-2',
        text: 'windowing for large collections',
        keywords: ['windowing', 'collections'],
        embedding: {
          backend: 'wasm',
          embeddedAt: 100,
          model: 'test-model',
          values: [1, 0],
          version: 'test',
        },
        metadata: { charCount: 24, sourceName: 'Semantic', tokenCount: 3 },
      },
    ]

    const results = retrieveKnowledge({
      chunks,
      query: 'virtual list performance',
      semantic: {
        enabled: true,
        queryEmbedding: [1, 0],
      },
      topK: 2,
    })

    expect(results.rerank.semanticEnabled).toBe(true)
    expect(results.rerank.rankedChunks[0]).toEqual(expect.objectContaining({
      id: 'lexical-lead',
      semanticScore: 1,
      totalScore: 12,
    }))
    expect(results.rerank.rankedChunks[1]).toEqual(expect.objectContaining({
      id: 'semantic-boosted',
      lexicalScore: 0,
      semanticScore: 1,
      totalScore: 3,
    }))
  })
})
