/**
 * Editor adapters abstract the quirks of different input surfaces.
 *
 * M1 explicitly optimizes around native text inputs. The resolver registry
 * keeps room for future adapters such as ProseMirror or richer
 * contenteditable-specific rendering without changing the content script flow.
 */

export type EditorKind = 'textarea' | 'input' | 'contenteditable';

export interface EditorHandle {
  kind: EditorKind;
  el: HTMLElement;
  /** Text before the caret (excluding any suggestion we have inserted). */
  getPrefix(): string;
  /** Text after the caret. */
  getSuffix(): string;
  /** Absolute viewport coordinates of the caret (top-left of a zero-width box). */
  getCaretRect(): DOMRect | null;
  /** Insert text at the caret and advance the caret past it. */
  insertAtCaret(text: string): void;
  /** Force focus back on the editor. */
  focus(): void;
  /** Whether the editor is currently empty. */
  isEmpty(): boolean;
}

export interface EditorResolver {
  name: string;
  supports(target: EventTarget | null): boolean;
  resolve(target: EventTarget | null): EditorHandle | null;
}

export function resolveEditor(target: EventTarget | null): EditorHandle | null {
  for (const resolver of EDITOR_RESOLVERS) {
    if (!resolver.supports(target)) continue;
    const handle = resolver.resolve(target);
    if (handle) return handle;
  }
  return null;
}

export const EDITOR_RESOLVERS: readonly EditorResolver[] = [
  {
    name: 'native-text',
    supports(target) {
      return (
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLInputElement && isTextualInput(target))
      );
    },
    resolve(target) {
      if (target instanceof HTMLTextAreaElement) {
        return new TextareaAdapter(target);
      }
      if (target instanceof HTMLInputElement && isTextualInput(target)) {
        return new TextareaAdapter(target);
      }
      return null;
    },
  },
] as const;

// Keep future adapters explicit, but do not activate them in M1. The current
// milestone is focused on making native text inputs reliable first.
export const FUTURE_EDITOR_RESOLVERS: readonly EditorResolver[] = [
  {
    name: 'contenteditable',
    supports(target) {
      return target instanceof HTMLElement && target.isContentEditable;
    },
    resolve(target) {
      if (!(target instanceof HTMLElement) || !target.isContentEditable) {
        return null;
      }
      const host = findContentEditableHost(target);
      return host ? new ContentEditableAdapter(host) : null;
    },
  },
] as const;

function isTextualInput(el: HTMLInputElement): boolean {
  const t = (el.type || 'text').toLowerCase();
  return ['text', 'search', 'url', 'email', 'tel'].includes(t);
}

function findContentEditableHost(start: HTMLElement): HTMLElement | null {
  let el: HTMLElement | null = start;
  while (el) {
    if (el.getAttribute?.('contenteditable') === 'true') return el;
    el = el.parentElement;
  }
  return null;
}

// ---------------------------------------------------------------------------
// <textarea> / <input>
// ---------------------------------------------------------------------------

class TextareaAdapter implements EditorHandle {
  readonly kind: EditorKind;
  readonly el: HTMLTextAreaElement | HTMLInputElement;

  constructor(el: HTMLTextAreaElement | HTMLInputElement) {
    this.el = el;
    this.kind = el instanceof HTMLTextAreaElement ? 'textarea' : 'input';
  }

  getPrefix(): string {
    const value = this.el.value;
    const pos = this.el.selectionStart ?? value.length;
    return value.slice(0, pos);
  }

  getSuffix(): string {
    const value = this.el.value;
    const pos = this.el.selectionEnd ?? value.length;
    return value.slice(pos);
  }

  getCaretRect(): DOMRect | null {
    return measureTextareaCaret(this.el);
  }

  insertAtCaret(text: string): void {
    const el = this.el;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const before = el.value.slice(0, start);
    const after = el.value.slice(end);

    // Use the standard setter so framework listeners (React, Vue) pick up the change.
    const setter = getNativeValueSetter(el);
    const next = before + text + after;
    setter(el, next);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    const caret = start + text.length;
    try {
      el.setSelectionRange(caret, caret);
    } catch {
      // <input type="email"> etc. throw when calling setSelectionRange. Ignore.
    }
  }

  focus(): void {
    this.el.focus();
  }

  isEmpty(): boolean {
    return !this.el.value;
  }
}

type NativeSetter = (el: HTMLInputElement | HTMLTextAreaElement, value: string) => void;

const cachedSetters = new WeakMap<Function, NativeSetter>();

function getNativeValueSetter(
  el: HTMLInputElement | HTMLTextAreaElement,
): NativeSetter {
  const proto = Object.getPrototypeOf(el);
  const ctor = proto.constructor;
  const existing = cachedSetters.get(ctor);
  if (existing) return existing;
  const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
  const setter: NativeSetter = descriptor?.set
    ? (node, value) => descriptor.set!.call(node, value)
    : (node, value) => {
        (node as any).value = value;
      };
  cachedSetters.set(ctor, setter);
  return setter;
}

// Mirror-div trick to measure caret position inside a textarea/input.
// This is the approach used by ace, Draft, Grammarly etc.
let mirrorDiv: HTMLDivElement | null = null;

const MIRROR_COPY_PROPS = [
  'boxSizing',
  'width',
  'height',
  'overflowX',
  'overflowY',
  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
  'borderStyle',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'fontStyle',
  'fontVariant',
  'fontWeight',
  'fontStretch',
  'fontSize',
  'fontSizeAdjust',
  'lineHeight',
  'fontFamily',
  'textAlign',
  'textTransform',
  'textIndent',
  'textDecoration',
  'letterSpacing',
  'wordSpacing',
  'tabSize',
  'whiteSpace',
  'wordBreak',
  'overflowWrap',
] as const;

function measureTextareaCaret(
  el: HTMLTextAreaElement | HTMLInputElement,
): DOMRect | null {
  const value = el.value;
  const pos = el.selectionStart ?? value.length;

  if (!mirrorDiv) {
    mirrorDiv = document.createElement('div');
    mirrorDiv.setAttribute('data-copycat-mirror', '');
    mirrorDiv.style.position = 'absolute';
    mirrorDiv.style.top = '0';
    mirrorDiv.style.left = '-9999px';
    mirrorDiv.style.visibility = 'hidden';
    mirrorDiv.style.pointerEvents = 'none';
    mirrorDiv.style.zIndex = '-1';
    document.body.appendChild(mirrorDiv);
  }

  const computed = window.getComputedStyle(el);
  const isInput = el instanceof HTMLInputElement;
  for (const prop of MIRROR_COPY_PROPS) {
    (mirrorDiv.style as any)[prop] = computed[prop as any];
  }
  mirrorDiv.style.whiteSpace = isInput ? 'pre' : 'pre-wrap';
  mirrorDiv.style.wordWrap = 'break-word';
  mirrorDiv.style.position = 'absolute';

  mirrorDiv.textContent = value.slice(0, pos);
  const marker = document.createElement('span');
  marker.textContent = value.slice(pos) || '\u200b';
  mirrorDiv.appendChild(marker);

  const rectElement = el.getBoundingClientRect();
  const markerRect = marker.getBoundingClientRect();
  const mirrorRect = mirrorDiv.getBoundingClientRect();

  const x =
    rectElement.left +
    (markerRect.left - mirrorRect.left) -
    el.scrollLeft;
  const y =
    rectElement.top +
    (markerRect.top - mirrorRect.top) -
    el.scrollTop;

  return new DOMRect(x, y, 0, markerRect.height || parseFloat(computed.lineHeight) || 18);
}

// ---------------------------------------------------------------------------
// contenteditable
// ---------------------------------------------------------------------------

class ContentEditableAdapter implements EditorHandle {
  readonly kind: EditorKind = 'contenteditable';
  readonly el: HTMLElement;

  constructor(el: HTMLElement) {
    this.el = el;
  }

  private currentRange(): Range | null {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    const range = sel.getRangeAt(0);
    if (!this.el.contains(range.startContainer)) return null;
    return range;
  }

  getPrefix(): string {
    const range = this.currentRange();
    if (!range) return this.el.textContent ?? '';
    const pre = range.cloneRange();
    pre.selectNodeContents(this.el);
    pre.setEnd(range.startContainer, range.startOffset);
    return pre.toString();
  }

  getSuffix(): string {
    const range = this.currentRange();
    if (!range) return '';
    const post = range.cloneRange();
    post.selectNodeContents(this.el);
    post.setStart(range.endContainer, range.endOffset);
    return post.toString();
  }

  getCaretRect(): DOMRect | null {
    const range = this.currentRange();
    if (!range) return null;
    const rects = range.getClientRects();
    if (rects.length > 0) return rects[rects.length - 1];
    const box = this.el.getBoundingClientRect();
    return new DOMRect(box.left, box.top, 0, box.height);
  }

  insertAtCaret(text: string): void {
    this.el.focus();
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) {
      this.el.textContent = (this.el.textContent ?? '') + text;
      this.el.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }));
      return;
    }

    // Prefer the modern API; falls back to execCommand for old browsers.
    let inserted = false;
    try {
      const event = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        data: text,
        inputType: 'insertText',
      });
      this.el.dispatchEvent(event);
      if (!event.defaultPrevented) {
        const range = sel.getRangeAt(0);
        range.deleteContents();
        const node = document.createTextNode(text);
        range.insertNode(node);
        range.setStartAfter(node);
        range.setEndAfter(node);
        sel.removeAllRanges();
        sel.addRange(range);
        inserted = true;
      }
    } catch {
      // fall through
    }

    if (!inserted) {
      document.execCommand?.('insertText', false, text);
    }

    this.el.dispatchEvent(
      new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }),
    );
  }

  focus(): void {
    this.el.focus();
  }

  isEmpty(): boolean {
    const txt = this.el.textContent ?? '';
    return txt.replace(/\s+/g, '') === '';
  }
}
