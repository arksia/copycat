import type { KnowledgeChunk } from '~/types'
import { describe, expect, it } from 'vitest'
import {
  buildKnowledgeContext,
  buildKnowledgeSearchQuery,
} from '~/utils/knowledge/prompt'

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
})
