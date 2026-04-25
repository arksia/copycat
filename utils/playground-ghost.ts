import { resolveEditor } from './editor-adapter';
import { GhostTextOverlay } from './ghost-text';

export function syncPlaygroundGhostText(
  overlay: GhostTextOverlay,
  target: HTMLTextAreaElement | null,
  suggestion: string,
): boolean {
  if (!target || !suggestion || document.activeElement !== target) {
    overlay.hide();
    return false;
  }

  const editor = resolveEditor(target);
  if (!editor) {
    overlay.hide();
    return false;
  }

  overlay.show(editor, suggestion);
  return true;
}
