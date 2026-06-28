/**
 * Editor adapters abstract the quirks of different input surfaces.
 *
 * Native text inputs stay the most precise path. Plain contenteditable hosts
 * use a conservative adapter so common custom chat boxes can share the same
 * content script flow without site-specific selectors.
 */

export type EditorKind = 'textarea' | 'input' | 'contenteditable'

export interface EditorHandle {
  kind: EditorKind
  el: HTMLElement
  /** Text before the caret (excluding any suggestion we have inserted). */
  getPrefix: () => string
  /** Text after the caret. */
  getSuffix: () => string
  /** Absolute viewport coordinates of the caret (top-left of a zero-width box). */
  getCaretRect: () => DOMRect | null
  /** Insert text at the caret and advance the caret past it. */
  insertAtCaret: (text: string) => void
  /** Force focus back on the editor. */
  focus: () => void
  /** Whether the editor is currently empty. */
  isEmpty: () => boolean
}

export interface EditorResolver {
  name: string
  supports: (target: EventTarget | null) => boolean
  resolve: (target: EventTarget | null) => EditorHandle | null
}

export const EDITOR_RESOLVERS: readonly EditorResolver[] = [
  {
    name: 'native-text',
    supports(target) {
      return (
        target instanceof HTMLTextAreaElement
        || (target instanceof HTMLInputElement && isTextualInput(target))
      )
    },
    resolve(target) {
      if (target instanceof HTMLTextAreaElement) {
        return new TextareaAdapter(target)
      }
      if (target instanceof HTMLInputElement && isTextualInput(target)) {
        return new TextareaAdapter(target)
      }
      return null
    },
  },
  {
    name: 'contenteditable',
    supports(target) {
      return target instanceof HTMLElement && findContentEditableHost(target) !== null
    },
    resolve(target) {
      if (!(target instanceof HTMLElement)) {
        return null
      }
      const host = findContentEditableHost(target)
      return host ? new ContentEditableAdapter(host) : null
    },
  },
] as const

export function resolveEditor(target: EventTarget | null): EditorHandle | null {
  for (const resolver of EDITOR_RESOLVERS) {
    if (!resolver.supports(target))
      continue
    const handle = resolver.resolve(target)
    if (handle)
      return handle
  }
  return null
}

function isTextualInput(el: HTMLInputElement): boolean {
  const t = (el.type || 'text').toLowerCase()
  return ['text', 'search', 'url', 'email', 'tel'].includes(t)
}

function findContentEditableHost(start: HTMLElement): HTMLElement | null {
  let el: HTMLElement | null = start
  while (el) {
    const value = (el.getAttribute('contenteditable') ?? '').toLowerCase()
    if (value === 'true' || value === 'plaintext-only')
      return el
    if (value === 'false')
      return null
    el = el.parentElement
  }
  return null
}

// ---------------------------------------------------------------------------
// <textarea> / <input>
// ---------------------------------------------------------------------------

class TextareaAdapter implements EditorHandle {
  readonly kind: EditorKind
  readonly el: HTMLTextAreaElement | HTMLInputElement

  constructor(el: HTMLTextAreaElement | HTMLInputElement) {
    this.el = el
    this.kind = el instanceof HTMLTextAreaElement ? 'textarea' : 'input'
  }

  getPrefix(): string {
    const value = this.el.value
    const pos = this.el.selectionStart ?? value.length
    return value.slice(0, pos)
  }

  getSuffix(): string {
    const value = this.el.value
    const pos = this.el.selectionEnd ?? value.length
    return value.slice(pos)
  }

  getCaretRect(): DOMRect | null {
    return measureTextareaCaret(this.el)
  }

  insertAtCaret(text: string): void {
    const el = this.el
    const start = el.selectionStart ?? el.value.length
    const end = el.selectionEnd ?? el.value.length
    const before = el.value.slice(0, start)
    const after = el.value.slice(end)

    // Use the standard setter so framework listeners (React, Vue) pick up the change.
    const setter = getNativeValueSetter(el)
    const next = before + text + after
    setter(el, next)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    const caret = start + text.length
    try {
      el.setSelectionRange(caret, caret)
    }
    catch {
      // <input type="email"> etc. throw when calling setSelectionRange. Ignore.
    }
  }

  focus(): void {
    this.el.focus()
  }

  isEmpty(): boolean {
    return !this.el.value
  }
}

type NativeSetter = (el: HTMLInputElement | HTMLTextAreaElement, value: string) => void

interface ValueSetterHost {
  constructor: object
}

const cachedSetters = new WeakMap<object, NativeSetter>()

function getNativeValueSetter(
  el: HTMLInputElement | HTMLTextAreaElement,
): NativeSetter {
  const proto = Object.getPrototypeOf(el) as ValueSetterHost
  const ctor = proto.constructor
  const existing = cachedSetters.get(ctor)
  if (existing)
    return existing
  const descriptor = Object.getOwnPropertyDescriptor(proto, 'value')
  // NOTICE:
  // We intentionally access the prototype `value` setter so framework-managed
  // inputs still observe native value updates through the real DOM setter.
  // `ts/unbound-method` treats `PropertyDescriptor#set` like a detached method,
  // but we invoke it immediately with `Reflect.apply`, so the receiver is explicit.
  // Source/context: `utils/editor-adapter.ts#getNativeValueSetter`.
  // Removal condition: remove once the typed lint rule handles property-descriptor
  // setters without this false positive.
  // eslint-disable-next-line ts/unbound-method
  const rawSetter = descriptor?.set
  const setter: NativeSetter
    = typeof rawSetter === 'function'
      ? (node, value) => {
          Reflect.apply(rawSetter, node, [value])
        }
      : (node, value) => {
          node.value = value
        }
  cachedSetters.set(ctor, setter)
  return setter
}

// Mirror-div trick to measure caret position inside a textarea/input.
// This is the approach used by ace, Draft, Grammarly etc.
let mirrorDiv: HTMLDivElement | null = null

const MIRROR_COPY_PROPS = [
  'box-sizing',
  'width',
  'height',
  'overflow-x',
  'overflow-y',
  'border-top-width',
  'border-right-width',
  'border-bottom-width',
  'border-left-width',
  'border-style',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'font-style',
  'font-variant',
  'font-weight',
  'font-stretch',
  'font-size',
  'font-size-adjust',
  'line-height',
  'font-family',
  'text-align',
  'text-transform',
  'text-indent',
  'text-decoration',
  'letter-spacing',
  'word-spacing',
  'tab-size',
  'white-space',
  'word-break',
  'overflow-wrap',
] as const

function measureTextareaCaret(
  el: HTMLTextAreaElement | HTMLInputElement,
): DOMRect | null {
  const value = el.value
  const pos = el.selectionStart ?? value.length

  if (!mirrorDiv) {
    mirrorDiv = document.createElement('div')
    mirrorDiv.setAttribute('data-copycat-mirror', '')
    mirrorDiv.style.position = 'absolute'
    mirrorDiv.style.top = '0'
    mirrorDiv.style.left = '-9999px'
    mirrorDiv.style.visibility = 'hidden'
    mirrorDiv.style.pointerEvents = 'none'
    mirrorDiv.style.zIndex = '-1'
    document.body.appendChild(mirrorDiv)
  }

  const computed = window.getComputedStyle(el)
  const isInput = el instanceof HTMLInputElement
  for (const prop of MIRROR_COPY_PROPS) {
    mirrorDiv.style.setProperty(prop, computed.getPropertyValue(prop))
  }
  mirrorDiv.style.whiteSpace = isInput ? 'pre' : 'pre-wrap'
  mirrorDiv.style.wordWrap = 'break-word'
  mirrorDiv.style.position = 'absolute'

  mirrorDiv.textContent = value.slice(0, pos)
  const marker = document.createElement('span')
  marker.textContent = value.slice(pos) || '\u200B'
  mirrorDiv.appendChild(marker)

  const rectElement = el.getBoundingClientRect()
  const markerRect = marker.getBoundingClientRect()
  const mirrorRect = mirrorDiv.getBoundingClientRect()

  const x
    = rectElement.left
      + (markerRect.left - mirrorRect.left)
      - el.scrollLeft
  const y
    = rectElement.top
      + (markerRect.top - mirrorRect.top)
      - el.scrollTop

  return new DOMRect(x, y, 0, markerRect.height || Number.parseFloat(computed.lineHeight) || 18)
}

// ---------------------------------------------------------------------------
// contenteditable
// ---------------------------------------------------------------------------

class ContentEditableAdapter implements EditorHandle {
  readonly kind: EditorKind = 'contenteditable'
  readonly el: HTMLElement

  constructor(el: HTMLElement) {
    this.el = el
  }

  private currentRange(): Range | null {
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0)
      return null
    if (!sel.isCollapsed)
      return null
    const range = sel.getRangeAt(0)
    if (!this.el.contains(range.startContainer))
      return null
    return range
  }

  getPrefix(): string {
    const range = this.currentRange()
    if (!range)
      return ''
    return getContentEditablePrefix(this.el, range)
  }

  getSuffix(): string {
    const range = this.currentRange()
    if (!range)
      return ''
    return getContentEditableSuffix(this.el, range)
  }

  getCaretRect(): DOMRect | null {
    const range = this.currentRange()
    if (!range)
      return null
    const rects = range.getClientRects()
    if (rects.length > 0)
      return rects[rects.length - 1]
    const box = this.el.getBoundingClientRect()
    return new DOMRect(box.left, box.top, 0, box.height)
  }

  insertAtCaret(text: string): void {
    const currentRange = this.currentRange()
    if (!currentRange) {
      return
    }
    const range = currentRange.cloneRange()
    this.el.focus()

    const beforeInput = createTextInputEvent('beforeinput', text, true)
    this.el.dispatchEvent(beforeInput)

    if (!beforeInput.defaultPrevented) {
      const sel = window.getSelection()
      if (!sel)
        return
      range.deleteContents()
      const node = document.createTextNode(text)
      range.insertNode(node)
      range.setStartAfter(node)
      range.setEndAfter(node)
      sel.removeAllRanges()
      sel.addRange(range)
    }

    this.el.dispatchEvent(createTextInputEvent('input', text, false))
  }

  focus(): void {
    this.el.focus()
  }

  isEmpty(): boolean {
    const txt = this.el.textContent ?? ''
    return txt.replace(/\s+/g, '') === ''
  }
}

function getContentEditablePrefix(host: HTMLElement, range: Range): string {
  const pre = range.cloneRange()
  pre.selectNodeContents(host)
  pre.setEnd(range.startContainer, range.startOffset)
  // TODO: Replace Range.toString() with a contenteditable DOM serializer that preserves visible line breaks before broad site support.
  return pre.toString()
}

function getContentEditableSuffix(host: HTMLElement, range: Range): string {
  const post = range.cloneRange()
  post.selectNodeContents(host)
  post.setStart(range.endContainer, range.endOffset)
  // TODO: Replace Range.toString() with a contenteditable DOM serializer that preserves visible line breaks before broad site support.
  return post.toString()
}

function createTextInputEvent(
  type: 'beforeinput' | 'input',
  text: string,
  cancelable: boolean,
): Event {
  try {
    return new InputEvent(type, {
      bubbles: true,
      cancelable,
      data: text,
      inputType: 'insertText',
    })
  }
  catch {
    return new Event(type, { bubbles: true, cancelable })
  }
}
