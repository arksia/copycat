import type { EditorHandle } from '~/utils/editor-adapter'
import { afterEach, describe, expect, it } from 'vitest'
import { GhostTextOverlay } from '~/utils/ghost-text'

afterEach(() => {
  document.documentElement
    .querySelectorAll('[data-copycat-ghost]')
    .forEach(node => node.remove())
})

describe('ghostTextOverlay', () => {
  it('uses a full-element mirror layer for textareas so wrapping follows the native box', () => {
    const editor = document.createElement('textarea')
    editor.value = 'hello'
    editor.style.fontSize = '16px'
    editor.style.lineHeight = '24px'
    editor.style.fontFamily = 'Menlo'
    editor.style.fontWeight = '400'
    editor.style.fontStyle = 'normal'
    editor.style.padding = '8px 12px'
    editor.style.border = '1px solid rgb(0, 0, 0)'
    document.body.appendChild(editor)

    Object.defineProperty(editor, 'clientWidth', { configurable: true, value: 198 })
    Object.defineProperty(editor, 'clientHeight', { configurable: true, value: 78 })
    Object.defineProperty(editor, 'scrollWidth', { configurable: true, value: 198 })
    Object.defineProperty(editor, 'scrollHeight', { configurable: true, value: 78 })
    editor.getBoundingClientRect = () => new DOMRect(20, 100, 200, 80)

    const handle: EditorHandle = {
      kind: 'textarea',
      el: editor,
      getPrefix: () => 'hello',
      getSuffix: () => '',
      getCaretRect: () => new DOMRect(52, 108, 0, 24),
      insertAtCaret: () => {},
      focus: () => {},
      isEmpty: () => false,
    }

    const overlay = new GhostTextOverlay()
    overlay.show(handle, '\nworld')

    const host = document.documentElement.querySelector<HTMLElement>(
      '[data-copycat-ghost]',
    )
    const content = host?.querySelector('[data-copycat-ghost-content]') as HTMLElement | null
    const prefix = host?.querySelector('[data-copycat-ghost-prefix]') as HTMLElement | null
    const suggestion = host?.querySelector(
      '[data-copycat-ghost-suggestion]',
    ) as HTMLElement | null

    expect(host?.style.top).toBe('100px')
    expect(host?.style.left).toBe('20px')
    expect(host?.style.width).toBe('200px')
    expect(host?.style.height).toBe('80px')
    expect(content?.style.whiteSpace).toBe('pre-wrap')
    expect(prefix?.style.visibility).toBe('hidden')
    expect(suggestion?.textContent).toBe('\nworld')
  })

  it('falls back to caret-anchored rendering for non-native editors', () => {
    const editor = document.createElement('div')
    editor.contentEditable = 'true'
    editor.style.fontSize = '16px'
    editor.style.lineHeight = '24px'
    document.body.appendChild(editor)

    const handle: EditorHandle = {
      kind: 'contenteditable',
      el: editor,
      getPrefix: () => 'hello',
      getSuffix: () => '',
      getCaretRect: () => new DOMRect(20, 100, 0, 24),
      insertAtCaret: () => {},
      focus: () => {},
      isEmpty: () => false,
    }

    const overlay = new GhostTextOverlay()
    overlay.show(handle, ' world')

    const host = document.documentElement.querySelector<HTMLElement>(
      '[data-copycat-ghost]',
    )

    expect(host?.style.top).toBe('100px')
    expect(host?.style.left).toBe('20px')
  })
})
