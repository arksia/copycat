import type { GhostTextOverlay } from './ghost-text'
import { resolveEditor } from './editor-adapter'

/**
 * Syncs the playground textarea state into the shared ghost-text overlay.
 *
 * Use when:
 * - the isolated textarea playground needs the same suggestion overlay behavior as content scripts
 *
 * Expects:
 * - `target` to be the active playground textarea when available
 * - `suggestion` to be the latest sanitized completion
 *
 * Returns:
 * - `true` when ghost text was shown, otherwise `false`
 */
export function syncPlaygroundGhostText(
  overlay: GhostTextOverlay,
  target: HTMLTextAreaElement | null,
  suggestion: string,
): boolean {
  if (!target || !suggestion || document.activeElement !== target) {
    overlay.hide()
    return false
  }

  const editor = resolveEditor(target)
  if (!editor) {
    overlay.hide()
    return false
  }

  overlay.show(editor, suggestion)
  return true
}
