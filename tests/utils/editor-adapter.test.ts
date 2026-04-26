import { describe, expect, it } from 'vitest'
import { EDITOR_RESOLVERS, resolveEditor } from '~/utils/editor-adapter'

describe('resolveEditor', () => {
  it('prefers the native text resolver for textareas', () => {
    const textarea = document.createElement('textarea')
    textarea.value = 'hello world'
    textarea.setSelectionRange(5, 5)
    document.body.appendChild(textarea)

    const handle = resolveEditor(textarea)

    expect(EDITOR_RESOLVERS[0]?.name).toBe('native-text')
    expect(handle?.kind).toBe('textarea')
    expect(handle?.getPrefix()).toBe('hello')
    expect(handle?.getSuffix()).toBe(' world')
  })

  it('inserts text at the caret for native inputs', () => {
    const input = document.createElement('input')
    input.type = 'text'
    input.value = 'hello'
    document.body.appendChild(input)
    input.setSelectionRange(5, 5)

    const handle = resolveEditor(input)
    handle?.insertAtCaret(' world')

    expect(input.value).toBe('hello world')
    expect(input.selectionStart).toBe(11)
    expect(input.selectionEnd).toBe(11)
  })
})
