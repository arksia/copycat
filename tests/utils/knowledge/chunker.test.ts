import { describe, expect, it } from 'vitest'
import { chunkKnowledgeDocument } from '~/knowledge'

describe('chunkKnowledgeDocument', () => {
  it('groups paragraphs into bounded chunks and keeps metadata', () => {
    const chunks = chunkKnowledgeDocument({
      docId: 'doc-1',
      kbId: 'default',
      sourceName: 'Architecture Notes',
      maxChars: 40,
      text: '第一段介绍虚拟列表。\n\n第二段介绍滚动容器。\n\nThird paragraph covers rendering.',
    })

    expect(chunks).toHaveLength(2)
    expect(chunks[0]).toMatchObject({
      id: 'doc-1:0',
      kbId: 'default',
      docId: 'doc-1',
      metadata: {
        sourceName: 'Architecture Notes',
      },
    })
    expect(chunks[0]?.text).toContain('第一段介绍虚拟列表。')
  })
})
