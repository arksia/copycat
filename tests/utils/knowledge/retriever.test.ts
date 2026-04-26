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

    expect(results).toEqual([chunks[0]])
  })
})
