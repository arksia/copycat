import type { KnowledgeChunk } from '~/types'
import { describe, expect, it } from 'vitest'
import {
  buildKnowledgeContext,
  buildKnowledgeContextProjection,
  buildKnowledgeSearchQuery,
} from '~/rag'

describe('buildKnowledgeSearchQuery', () => {
  it('uses the trailing prompt fragment instead of the entire prefix', () => {
    expect(buildKnowledgeSearchQuery(
      '我先讨论一下博客系统的规划。\n\n现在重点是虚拟列表的渲染性能和滚动体验',
    )).toBe('现在重点是虚拟列表的渲染性能和滚动体验')
  })
})

describe('buildKnowledgeContext', () => {
  it('packs only the top chunks into a compact knowledge block', () => {
    const chunks: KnowledgeChunk[] = [
      {
        id: 'chunk-1',
        kbId: 'default',
        docId: 'doc-1',
        text: '虚拟列表适合处理长列表渲染和滚动性能问题。',
        keywords: ['虚拟列表', '滚动', '性能'],
        metadata: {
          charCount: 20,
          sourceName: 'Virtual List Notes',
          tokenCount: 14,
        },
      },
      {
        id: 'chunk-2',
        kbId: 'default',
        docId: 'doc-1',
        text: '实现时要避免一次渲染全部节点。',
        keywords: ['渲染', '节点'],
        metadata: {
          charCount: 16,
          sourceName: 'Virtual List Notes',
          tokenCount: 10,
        },
      },
      {
        id: 'chunk-3',
        kbId: 'default',
        docId: 'doc-2',
        text: '这条不应该被选中。',
        keywords: ['其他'],
        metadata: {
          charCount: 10,
          sourceName: 'Other',
          tokenCount: 5,
        },
      },
    ]

    expect(buildKnowledgeContext({
      chunks,
      maxChars: 80,
      maxChunks: 2,
    })).toBe(
      '[Virtual List Notes]\n虚拟列表适合处理长列表渲染和滚动性能问题。\n\n'
      + '[Virtual List Notes]\n实现时要避免一次渲染全部节点。',
    )
  })

  it('trims an oversized chunk instead of dropping the whole context block', () => {
    const chunks: KnowledgeChunk[] = [
      {
        id: 'chunk-1',
        kbId: 'default',
        docId: 'doc-1',
        text: '这是一段很长的知识片段，用来验证超长 chunk 会被裁剪而不是整个丢弃。'.repeat(6),
        keywords: ['知识', '裁剪'],
        metadata: {
          charCount: 120,
          sourceName: 'Long Notes',
          tokenCount: 60,
        },
      },
    ]

    const projection = buildKnowledgeContextProjection({
      chunks,
      maxChars: 80,
      maxChunks: 2,
    })

    expect(projection.context).toContain('[Long Notes]\n')
    expect(projection.context).toContain('...')
    expect(projection.meta.usedChars).toBe(projection.context.length)
    expect(projection.meta.truncated).toBe(true)
    expect(projection.meta.includedChunkIds).toEqual(['chunk-1'])
    expect(projection.meta.trimmedChunkIds).toEqual(['chunk-1'])
  })

  it('records dropped chunks when the prompt budget fills before later chunks fit', () => {
    const chunks: KnowledgeChunk[] = [
      {
        id: 'chunk-1',
        kbId: 'default',
        docId: 'doc-1',
        text: '第一条知识片段。',
        keywords: ['第一条'],
        metadata: {
          charCount: 8,
          sourceName: 'Doc A',
          tokenCount: 4,
        },
      },
      {
        id: 'chunk-2',
        kbId: 'default',
        docId: 'doc-1',
        text: '第二条知识片段长度明显更长，用来触发预算不足时的丢弃行为。'.repeat(4),
        keywords: ['第二条'],
        metadata: {
          charCount: 80,
          sourceName: 'Doc B',
          tokenCount: 40,
        },
      },
    ]

    const projection = buildKnowledgeContextProjection({
      chunks,
      maxChars: 40,
      maxChunks: 2,
    })

    expect(projection.context).toContain('[Doc A]\n第一条知识片段。')
    expect(projection.context).not.toContain('[Doc B]')
    expect(projection.meta.includedChunkIds).toEqual(['chunk-1'])
    expect(projection.meta.droppedChunkIds).toEqual(['chunk-2'])
  })
})
