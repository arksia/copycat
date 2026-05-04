import { describe, expect, it } from 'vitest'
import { parseKnowledgeDocumentContent } from '~/utils/knowledge/normalize'

describe('parseKnowledgeDocumentContent', () => {
  it('strips lightweight markdown syntax into plain text', () => {
    expect(parseKnowledgeDocumentContent({
      rawContent: '# Title\n\n- Item one\n- Item two\n\n`code`',
      sourceType: 'markdown',
    })).toBe('Title\nItem one\nItem two\n\ncode')
  })
})
