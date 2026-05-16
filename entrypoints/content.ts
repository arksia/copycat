import type {
  CompletionEvent,
  CompletionRequest,
  CompletionResponse,
  Settings,
} from '~/types'
import type { EditorHandle } from '~/utils/editor-adapter'
import type {
  CompletionEffect,
  CompletionSnapshot,
  CompletionState,
} from '~/utils/completion/state'
import { buildCompletionFingerprint, buildCompletionSignalKey } from '~/utils/completion/request'
import { CompletionController } from '~/utils/completion/controller'
import { supportsInlineCompletion } from '~/utils/completion/position'
import { debounce, nextId } from '~/utils/core/base'
import { sendRuntimeMessage } from '~/utils/core/runtime'
import { resolveEditor } from '~/utils/editor-adapter'
import { GhostTextOverlay } from '~/utils/ghost-text'
import { isHostEnabled, loadSettings, onSettingsChanged } from '~/utils/settings'

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  allFrames: true,
  main() {
    startCopycatController()
  },
})

function startCopycatController(): void {
  void new CopycatFlowController()
}

function createEditorId(editor: EditorHandle): string {
  const host = editor.el.getAttribute('data-copycat-editor-id')
  if (host) {
    return host
  }
  const id = nextId('editor')
  editor.el.setAttribute('data-copycat-editor-id', id)
  return id
}

class CopycatFlowController {
  private settings: Settings | null = null
  private overlay = new GhostTextOverlay()
  private activeEditor: EditorHandle | null = null
  private snapshotRevision = 0
  private debounceHandles = new Map<string, ReturnType<typeof debounce<() => void>>>()
  private controller = new CompletionController({
    onEffects: (effects, state) => {
      void this.applyEffects(effects, state)
    },
  })
  private attached = false

  constructor() {
    void loadSettings().then((s) => {
      this.settings = s
      if (isHostEnabled(s, location.href)) {
        this.attach()
      }
    })

    onSettingsChanged((s) => {
      this.settings = s
      if (isHostEnabled(s, location.href))
        this.attach()
      else this.detach()
    })
  }

  private attach() {
    if (this.attached)
      return
    this.attached = true

    document.addEventListener('focusin', this.onFocusIn, true)
    document.addEventListener('focusout', this.onFocusOut, true)
    document.addEventListener('input', this.onInput, true)
    document.addEventListener('keydown', this.onKeyDown, true)
    document.addEventListener('compositionstart', this.onCompositionStart, true)
    document.addEventListener('compositionend', this.onCompositionEnd, true)
    document.addEventListener('selectionchange', this.onSelectionChange, true)
    document.addEventListener('mousedown', this.onMouseDown, true)
    document.addEventListener('scroll', this.onReposition, true)
    window.addEventListener('resize', this.onReposition, true)
  }

  private detach() {
    if (!this.attached)
      return
    this.attached = false
    document.removeEventListener('focusin', this.onFocusIn, true)
    document.removeEventListener('focusout', this.onFocusOut, true)
    document.removeEventListener('input', this.onInput, true)
    document.removeEventListener('keydown', this.onKeyDown, true)
    document.removeEventListener('compositionstart', this.onCompositionStart, true)
    document.removeEventListener('compositionend', this.onCompositionEnd, true)
    document.removeEventListener('selectionchange', this.onSelectionChange, true)
    document.removeEventListener('mousedown', this.onMouseDown, true)
    document.removeEventListener('scroll', this.onReposition, true)
    window.removeEventListener('resize', this.onReposition, true)
    this.deactivateEditor()
  }

  private logDebug(event: string, extra: Record<string, unknown> = {}) {
    const snapshot = this.controller.getState().snapshot
    console.debug('[copycat][flow]', event, {
      mode: this.controller.getState().mode,
      prefixLength: snapshot?.prefix.length ?? 0,
      suffixLength: snapshot?.suffix.length ?? 0,
      ...extra,
    })
  }

  private onFocusIn = (e: FocusEvent) => {
    const editor = resolveEditor(e.target)
    if (!editor) {
      return
    }
    this.activeEditor = editor
    this.refreshSnapshot(editor)
  }

  private onFocusOut = () => {
    setTimeout(() => {
      const active = document.activeElement as HTMLElement | null
      if (!active || !resolveEditor(active)) {
        this.deactivateEditor()
      }
    }, 50)
  }

  private onMouseDown = (e: MouseEvent) => {
    const ghost = (e.target as HTMLElement)?.closest?.('[data-copycat-ghost]')
    if (ghost !== null) {
      return
    }
    if (this.activeEditor) {
      this.refreshSnapshot(this.activeEditor)
    }
  }

  private onSelectionChange = () => {
    if (!this.activeEditor)
      return
    this.refreshSnapshot(this.activeEditor)
  }

  private onCompositionStart = () => {
    this.controller.dispatch({ type: 'COMPOSITION_STARTED' })
  }

  private onCompositionEnd = () => {
    if (!this.activeEditor) {
      return
    }
    const snapshot = this.buildSnapshot(this.activeEditor)
    if (!snapshot) {
      return
    }
    this.controller.dispatch({
      snapshot,
      type: 'COMPOSITION_ENDED',
    })
  }

  private onInput = (e: Event) => {
    const editor = resolveEditor(e.target)
    if (!editor) {
      return
    }
    this.activeEditor = editor
    this.refreshSnapshot(editor)
  }

  private onKeyDown = (e: KeyboardEvent) => {
    const state = this.controller.getState()
    if (!state.session || !this.activeEditor)
      return
    if (e.isComposing)
      return

    if (e.key === 'Tab' && state.session.suggestion) {
      e.preventDefault()
      e.stopPropagation()
      this.activeEditor.insertAtCaret(state.session.suggestion)
      this.controller.dispatch({
        sessionId: state.session.sessionId,
        type: 'SUGGESTION_ACCEPTED',
      })
      return
    }

    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      this.controller.dispatch({
        sessionId: state.session.sessionId,
        type: 'SUGGESTION_REJECTED',
      })
      return
    }
  }

  private onReposition = () => {
    const state = this.controller.getState()
    if (!this.activeEditor || !state.session?.suggestion) {
      return
    }
    this.overlay.show(this.activeEditor, state.session.suggestion)
  }

  private deactivateEditor() {
    this.activeEditor = null
    this.controller.dispatch({
      type: 'EDITOR_DEACTIVATED',
    })
  }

  private buildSnapshot(editor: EditorHandle): CompletionSnapshot | null {
    if (!this.settings) {
      return null
    }
    const prefix = editor.getPrefix()
    const suffix = editor.getSuffix()
    const value = prefix + suffix
    const selectionStart = prefix.length
    const selectionEnd = value.length - suffix.length
    this.snapshotRevision += 1
    return {
      editorId: createEditorId(editor),
      editorKind: editor.kind,
      eligible: !this.controller.getState().composeActive
        && prefix.trim().length >= this.settings.minPrefixChars
        && supportsInlineCompletion(suffix),
      fingerprint: buildCompletionFingerprint({
        host: location.host,
        editorKind: editor.kind,
        prefix,
        suffix,
      }),
      prefix,
      revision: this.snapshotRevision,
      selectionEnd,
      selectionStart,
      suffix,
      value,
    }
  }

  private refreshSnapshot(editor: EditorHandle) {
    const snapshot = this.buildSnapshot(editor)
    if (!snapshot) {
      return
    }
    this.logDebug('snapshot-updated', {
      eligible: snapshot.eligible,
      revision: snapshot.revision,
    })
    this.controller.dispatch({
      snapshot,
      type: 'SNAPSHOT_UPDATED',
    })
  }

  private async applyEffects(effects: CompletionEffect[], state: CompletionState) {
    for (const effect of effects) {
      switch (effect.type) {
        case 'SCHEDULE_DEBOUNCE': {
          const existing = this.debounceHandles.get(effect.sessionId)
          existing?.cancel()
          const handle = debounce(() => {
            this.controller.dispatch({
              sessionId: effect.sessionId,
              type: 'DEBOUNCE_ELAPSED',
            })
          }, Math.max(50, this.settings?.debounceMs ?? 300))
          this.debounceHandles.set(effect.sessionId, handle)
          handle()
          break
        }

        case 'CANCEL_DEBOUNCE': {
          const handle = this.debounceHandles.get(effect.sessionId)
          handle?.cancel()
          this.debounceHandles.delete(effect.sessionId)
          break
        }

        case 'REQUEST_COMPLETION': {
          if (!state.snapshot || !state.session || state.session.sessionId !== effect.sessionId) {
            break
          }
          const requestId = nextId('req')
          this.controller.dispatch({
            requestId,
            sessionId: effect.sessionId,
            type: effect.stage === 'fast' ? 'FAST_REQUEST_STARTED' : 'ENHANCED_REQUEST_STARTED',
          })
          const req: CompletionRequest = {
            id: requestId,
            prefix: state.snapshot.prefix,
            suffix: state.snapshot.suffix,
            signalKey: buildCompletionSignalKey(location.host, state.snapshot.editorKind as EditorHandle['kind']),
            stage: effect.stage,
          }
          try {
            const res = await sendRuntimeMessage<CompletionResponse>({
              type: 'completion/request',
              payload: req,
            })
            this.controller.dispatch(effect.stage === 'fast'
              ? {
                  latencyMs: res.latencyMs,
                  originalSuggestion: res.completion,
                  requestId,
                  sessionId: effect.sessionId,
                  shouldRunEnhancedStage: res.stage === 'fast' && res.shouldRunEnhancedStage,
                  suggestion: res.completion,
                  type: 'FAST_REQUEST_RESOLVED',
                }
              : {
                  latencyMs: res.latencyMs,
                  originalSuggestion: res.completion,
                  requestId,
                  sessionId: effect.sessionId,
                  suggestion: res.completion,
                  type: 'ENHANCED_REQUEST_RESOLVED',
                })
          }
          catch {
            this.controller.dispatch({
              sessionId: effect.sessionId,
              type: 'SESSION_CANCELLED',
            })
          }
          break
        }

        case 'CANCEL_REQUEST': {
          if (effect.requestId) {
            void sendRuntimeMessage({
              type: 'completion/cancel',
              payload: { id: effect.requestId },
            }).catch(() => {})
          }
          break
        }

        case 'SHOW_SUGGESTION': {
          if (!this.activeEditor) {
            break
          }
          this.overlay.show(this.activeEditor, effect.suggestion)
          break
        }

        case 'CLEAR_SUGGESTION': {
          this.overlay.hide()
          break
        }

        case 'EMIT_EVENT': {
          const id = nextId('evt')
          const payload: CompletionEvent = {
            action: effect.action,
            host: location.host,
            id,
            latencyMs: effect.latencyMs,
            prefix: effect.prefix,
            suggestion: effect.suggestion,
            timestamp: Date.now(),
          }
          void sendRuntimeMessage<void>({
            type: 'completion/event',
            payload,
          }).catch(() => {})
          break
        }
      }
    }
  }
}
