import { describe, expect, it } from 'vitest'
import { supportsInlineCompletion } from '~/utils/completion/position'

describe('supportsInlineCompletion', () => {
  it('allows completion when the caret is at the end of the text', () => {
    expect(supportsInlineCompletion('')).toBe(true)
  })

  it('disables completion when there is any suffix after the caret', () => {
    expect(supportsInlineCompletion(' world')).toBe(false)
    expect(supportsInlineCompletion(' ')).toBe(false)
    expect(supportsInlineCompletion('\n')).toBe(false)
  })
})
