import type { EditorHandle } from './editor-adapter';

/**
 * Native text inputs render ghost text through a full-element mirror layer so
 * line wrapping, scroll offsets, and typography track the real control.
 * Rich-text editors keep the lighter caret-anchored fallback for now.
 */
const MIRROR_COPY_PROPS = [
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
  'wordBreak',
  'overflowWrap',
] as const;

export class GhostTextOverlay {
  private host: HTMLElement;
  private contentNode: HTMLDivElement;
  private prefixNode: HTMLSpanElement;
  private suggestionNode: HTMLSpanElement;
  private hintNode: HTMLSpanElement;
  private installed = false;

  constructor() {
    this.host = document.createElement('div');
    this.host.setAttribute('data-copycat-ghost', '');
    Object.assign(this.host.style, {
      position: 'fixed',
      zIndex: '2147483646',
      pointerEvents: 'none',
      display: 'none',
      background: 'transparent',
      overflow: 'hidden',
    } satisfies Partial<CSSStyleDeclaration>);

    this.contentNode = document.createElement('div');
    this.contentNode.setAttribute('data-copycat-ghost-content', '');
    Object.assign(this.contentNode.style, {
      position: 'absolute',
      top: '0',
      left: '0',
      color: 'transparent',
      background: 'transparent',
    } satisfies Partial<CSSStyleDeclaration>);

    this.prefixNode = document.createElement('span');
    this.prefixNode.setAttribute('data-copycat-ghost-prefix', '');
    this.prefixNode.style.visibility = 'hidden';

    this.suggestionNode = document.createElement('span');
    this.suggestionNode.setAttribute('data-copycat-ghost-suggestion', '');
    this.suggestionNode.style.color = 'rgba(115, 115, 115, 0.72)';

    this.hintNode = document.createElement('span');
    Object.assign(this.hintNode.style, {
      position: 'absolute',
      right: '8px',
      bottom: '6px',
      padding: '1px 6px',
      fontSize: '10px',
      fontStyle: 'normal',
      borderRadius: '4px',
      background: 'rgba(139, 92, 246, 0.12)',
      color: 'rgb(109, 40, 217)',
      whiteSpace: 'nowrap',
    } satisfies Partial<CSSStyleDeclaration>);
    this.hintNode.textContent = 'Tab';

    this.contentNode.append(this.prefixNode, this.suggestionNode);
    this.host.append(this.contentNode, this.hintNode);
  }

  private ensureInstalled() {
    if (this.installed) return;
    document.documentElement.appendChild(this.host);
    this.installed = true;
  }

  show(editor: EditorHandle, suggestion: string) {
    if (!suggestion) {
      this.hide();
      return;
    }
    this.ensureInstalled();

    if (isNativeTextEditor(editor.el)) {
      this.showNativeMirror(editor, suggestion);
      return;
    }

    this.showFloatingGhost(editor, suggestion);
  }

  hide() {
    this.host.style.display = 'none';
    this.prefixNode.textContent = '';
    this.suggestionNode.textContent = '';
  }

  dispose() {
    this.host.remove();
    this.installed = false;
  }

  private showNativeMirror(editor: EditorHandle, suggestion: string) {
    const el = editor.el as HTMLTextAreaElement | HTMLInputElement;
    const rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      this.hide();
      return;
    }

    const style = window.getComputedStyle(el);
    const isInput = el instanceof HTMLInputElement;
    const paddingTop = parseFloat(style.paddingTop) || 0;
    const paddingRight = parseFloat(style.paddingRight) || 0;
    const paddingLeft = parseFloat(style.paddingLeft) || 0;
    const borderTop = parseFloat(style.borderTopWidth) || 0;
    const borderLeft = parseFloat(style.borderLeftWidth) || 0;
    const contentWidth = Math.max(
      0,
      el.clientWidth - paddingLeft - paddingRight,
    );

    this.applyTypography(style);
    this.host.style.top = `${rect.top}px`;
    this.host.style.left = `${rect.left}px`;
    this.host.style.width = `${rect.width}px`;
    this.host.style.height = `${rect.height}px`;
    this.host.style.display = 'block';

    this.contentNode.style.top = `${borderTop + paddingTop}px`;
    this.contentNode.style.left = `${borderLeft + paddingLeft}px`;
    this.contentNode.style.width = `${contentWidth}px`;
    this.contentNode.style.whiteSpace = isInput ? 'pre' : 'pre-wrap';
    this.contentNode.style.wordBreak = 'break-word';
    this.contentNode.style.overflowWrap = 'break-word';
    this.contentNode.style.transform = `translate(${-el.scrollLeft}px, ${-el.scrollTop}px)`;

    this.prefixNode.textContent = editor.getPrefix();
    this.suggestionNode.textContent = suggestion;
    this.hintNode.style.display = 'inline-block';
  }

  private showFloatingGhost(editor: EditorHandle, suggestion: string) {
    const rect = editor.getCaretRect();
    if (!rect) {
      this.hide();
      return;
    }

    const style = window.getComputedStyle(editor.el);
    this.applyTypography(style);
    this.host.style.top = `${rect.top}px`;
    this.host.style.left = `${rect.left}px`;
    this.host.style.width = 'auto';
    this.host.style.height = 'auto';
    this.host.style.display = 'block';

    this.contentNode.style.top = '0';
    this.contentNode.style.left = '0';
    this.contentNode.style.width = 'auto';
    this.contentNode.style.whiteSpace = 'pre-wrap';
    this.contentNode.style.wordBreak = 'break-word';
    this.contentNode.style.overflowWrap = 'break-word';
    this.contentNode.style.transform = 'none';

    this.prefixNode.textContent = '';
    this.suggestionNode.textContent = suggestion;
    this.hintNode.style.display = 'inline-block';
  }

  private applyTypography(style: CSSStyleDeclaration) {
    for (const prop of MIRROR_COPY_PROPS) {
      (this.contentNode.style as any)[prop] = style[prop as any];
      (this.suggestionNode.style as any)[prop] = style[prop as any];
    }
  }
}

function isNativeTextEditor(
  el: HTMLElement,
): el is HTMLTextAreaElement | HTMLInputElement {
  return el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement;
}
