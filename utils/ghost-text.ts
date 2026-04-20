import type { EditorHandle } from './editor-adapter';

/**
 * Render ghost-text as a floating overlay positioned at the caret.
 *
 * For MVP we intentionally avoid touching the editor's DOM — this matters for
 * ProseMirror and contenteditable editors with their own internal state.
 * The overlay is pointer-events:none and lives on document.body.
 */
export class GhostTextOverlay {
  private host: HTMLElement;
  private textNode: HTMLSpanElement;
  private hintNode: HTMLSpanElement;
  private installed = false;

  constructor() {
    this.host = document.createElement('div');
    this.host.setAttribute('data-copycat-ghost', '');
    Object.assign(this.host.style, {
      position: 'fixed',
      zIndex: '2147483646',
      pointerEvents: 'none',
      color: 'rgba(115, 115, 115, 0.7)',
      fontStyle: 'italic',
      whiteSpace: 'pre-wrap',
      maxWidth: '70vw',
      lineHeight: '1',
      display: 'none',
      background: 'transparent',
    } satisfies Partial<CSSStyleDeclaration>);

    this.textNode = document.createElement('span');
    this.hintNode = document.createElement('span');
    Object.assign(this.hintNode.style, {
      marginLeft: '8px',
      padding: '1px 6px',
      fontSize: '10px',
      fontStyle: 'normal',
      borderRadius: '4px',
      background: 'rgba(139, 92, 246, 0.12)',
      color: 'rgb(109, 40, 217)',
      verticalAlign: 'middle',
    } satisfies Partial<CSSStyleDeclaration>);
    this.hintNode.textContent = 'Tab';

    this.host.append(this.textNode, this.hintNode);
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

    const rect = editor.getCaretRect();
    if (!rect) {
      this.hide();
      return;
    }

    // Copy typography from the editor so the ghost text visually blends in.
    const editorStyle = window.getComputedStyle(editor.el);
    this.textNode.style.fontFamily = editorStyle.fontFamily;
    this.textNode.style.fontSize = editorStyle.fontSize;
    this.textNode.style.fontWeight = editorStyle.fontWeight;
    this.textNode.style.lineHeight = editorStyle.lineHeight;
    this.host.style.lineHeight = editorStyle.lineHeight;

    this.textNode.textContent = suggestion;

    const top = rect.top;
    const left = rect.left;
    this.host.style.top = `${top}px`;
    this.host.style.left = `${left}px`;
    this.host.style.display = 'inline-flex';
    this.host.style.alignItems = 'baseline';
  }

  hide() {
    this.host.style.display = 'none';
    this.textNode.textContent = '';
  }

  dispose() {
    this.host.remove();
    this.installed = false;
  }
}
