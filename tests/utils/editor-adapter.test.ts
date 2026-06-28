import { afterEach, describe, expect, it } from 'vitest'
import { EDITOR_RESOLVERS, resolveEditor } from '~/integrations/editors/adapter'

afterEach(() => {
  document.body.textContent = ''
  window.getSelection()?.removeAllRanges()
})

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

  it('resolves a contenteditable host from a child target', () => {
    const editor = document.createElement('div')
    editor.setAttribute('contenteditable', 'true')
    const child = document.createElement('span')
    child.textContent = 'hello world'
    editor.appendChild(child)
    document.body.appendChild(editor)
    setCaret(child.firstChild, 5)

    const handle = resolveEditor(child)

    expect(handle?.kind).toBe('contenteditable')
    expect(handle?.el).toBe(editor)
    expect(handle?.getPrefix()).toBe('hello')
    expect(handle?.getSuffix()).toBe(' world')
  })

  it('supports plaintext-only contenteditable hosts', () => {
    const editor = document.createElement('div')
    editor.setAttribute('contenteditable', 'plaintext-only')
    editor.textContent = 'draft'
    document.body.appendChild(editor)
    setCaret(editor.firstChild, 5)

    const handle = resolveEditor(editor)

    expect(handle?.kind).toBe('contenteditable')
    expect(handle?.getPrefix()).toBe('draft')
  })

  it('does not resolve implicit or false contenteditable values', () => {
    const implicit = document.createElement('div')
    implicit.setAttribute('contenteditable', '')
    const disabled = document.createElement('div')
    disabled.setAttribute('contenteditable', 'false')
    document.body.append(implicit, disabled)

    expect(resolveEditor(implicit)).toBeNull()
    expect(resolveEditor(disabled)).toBeNull()
  })

  it('does not resolve editable descendants inside a disabled contenteditable subtree', () => {
    const editor = document.createElement('div')
    editor.setAttribute('contenteditable', 'true')
    const disabled = document.createElement('span')
    disabled.setAttribute('contenteditable', 'false')
    disabled.textContent = 'disabled'
    editor.appendChild(disabled)
    document.body.appendChild(editor)

    expect(resolveEditor(disabled)).toBeNull()
  })

  it('suppresses contenteditable text reads for non-collapsed selections', () => {
    const editor = document.createElement('div')
    editor.setAttribute('contenteditable', 'true')
    editor.textContent = 'hello world'
    document.body.appendChild(editor)
    setSelection(editor.firstChild, 0, editor.firstChild, 5)

    const handle = resolveEditor(editor)

    expect(handle?.kind).toBe('contenteditable')
    expect(handle?.getPrefix()).toBe('')
    expect(handle?.getSuffix()).toBe('')
  })

  it('inserts text into a contenteditable collapsed range and emits input events', () => {
    const editor = document.createElement('div')
    editor.setAttribute('contenteditable', 'true')
    editor.textContent = 'hello'
    document.body.appendChild(editor)
    setCaret(editor.firstChild, 5)
    const events: string[] = []
    editor.addEventListener('beforeinput', event => events.push(event.type))
    editor.addEventListener('input', event => events.push(event.type))

    const handle = resolveEditor(editor)
    handle?.insertAtCaret(' world')

    expect(editor.textContent).toBe('hello world')
    expect(handle?.getPrefix()).toBe('hello world')
    expect(events).toEqual(['beforeinput', 'input'])
  })

  it('does not manually insert contenteditable text when beforeinput is prevented', () => {
    const editor = document.createElement('div')
    editor.setAttribute('contenteditable', 'true')
    editor.textContent = 'hello'
    document.body.appendChild(editor)
    setCaret(editor.firstChild, 5)
    const events: string[] = []
    editor.addEventListener('beforeinput', (event) => {
      events.push(event.type)
      event.preventDefault()
    })
    editor.addEventListener('input', event => events.push(event.type))

    const handle = resolveEditor(editor)
    handle?.insertAtCaret(' world')

    expect(editor.textContent).toBe('hello')
    expect(events).toEqual(['beforeinput', 'input'])
  })
})

function setCaret(node: Node | null, offset: number): void {
  if (!node)
    throw new Error('Missing caret node')
  setSelection(node, offset, node, offset)
}

function setSelection(
  startNode: Node | null,
  startOffset: number,
  endNode: Node | null,
  endOffset: number,
): void {
  if (!startNode || !endNode)
    throw new Error('Missing selection node')
  const range = document.createRange()
  range.setStart(startNode, startOffset)
  range.setEnd(endNode, endOffset)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
}
