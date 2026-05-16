import { describe, expect, it } from 'vitest'
import { supportsInlineCompletion } from '~/utils/completion/position'

describe('playground caret gating', () => {
  it('treats a mid-text caret as blocked for inline completion', () => {
    const draft = 'hello world'
    const caret = 5
    const suffix = draft.slice(caret)

    expect(supportsInlineCompletion(suffix)).toBe(false)
  })
})
