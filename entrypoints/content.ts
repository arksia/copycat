import type {
  CompletionEvent,
  CompletionRequest,
  CompletionResponse,
  Settings,
} from '~/types'
import type { EditorHandle } from '~/utils/editor-adapter'
import {
  buildCompletionFingerprint,
  buildCompletionSignalKey,
} from '~/utils/completion-request'
import { debounce } from '~/utils/debounce'
import { resolveEditor } from '~/utils/editor-adapter'
import { GhostTextOverlay } from '~/utils/ghost-text'
import { nextId } from '~/utils/id'
import { sendRuntimeMessage } from '~/utils/messages'
import { isHostEnabled, loadSettings, onSettingsChanged } from '~/utils/settings'
import {
  shouldPreferEnhancedCompletion,
  shouldRequestEnhancedStage,
} from '~/utils/two-stage'

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  allFrames: true,
  main() {
    startCopycatController()
  },
})

function startCopycatController(): void {
  void new CopycatController()
}

interface ActiveSuggestion {
  id: string
  editor: EditorHandle
  latencyMs: number
  originalSuggestion: string
  prefix: string
  suggestion: string
}

class CopycatController {
  private settings: Settings | null = null
  private overlay = new GhostTextOverlay()
  private activeEditor: EditorHandle | null = null
  private active: ActiveSuggestion | null = null
  private composing = false
  private lastRequestId: string | null = null
  private pendingFingerprint: string | null = null
  private debouncedRequest: ReturnType<typeof debounce<() => void>>

  constructor() {
    this.debouncedRequest = debounce(() => {
      void this.requestCompletion()
    }, 300)

    void loadSettings().then((s) => {
      this.settings = s
      this.debouncedRequest = debounce(
        () => {
          void this.requestCompletion()
        },
        Math.max(50, s.debounceMs),
      )
      if (isHostEnabled(s, location.href)) {
        this.attach()
      }
    })

    onSettingsChanged((s) => {
      this.settings = s
      this.debouncedRequest.cancel()
      this.debouncedRequest = debounce(
        () => {
          void this.requestCompletion()
        },
        Math.max(50, s.debounceMs),
      )
      if (isHostEnabled(s, location.href))
        this.attach()
      else this.detach()
    })
  }

  private attached = false

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
    document.addEventListener('scroll', this.onReposition, true)
    window.addEventListener('resize', this.onReposition, true)
    document.addEventListener('selectionchange', this.onSelectionChange, true)
    document.addEventListener('mousedown', this.onMouseDown, true)
  }

  private detach() {
    if (!this.attached)
      return
    this.attached = false
    this.dismiss()
    document.removeEventListener('focusin', this.onFocusIn, true)
    document.removeEventListener('focusout', this.onFocusOut, true)
    document.removeEventListener('input', this.onInput, true)
    document.removeEventListener('keydown', this.onKeyDown, true)
    document.removeEventListener('compositionstart', this.onCompositionStart, true)
    document.removeEventListener('compositionend', this.onCompositionEnd, true)
    document.removeEventListener('scroll', this.onReposition, true)
    window.removeEventListener('resize', this.onReposition, true)
    document.removeEventListener('selectionchange', this.onSelectionChange, true)
    document.removeEventListener('mousedown', this.onMouseDown, true)
  }

  private onFocusIn = (e: FocusEvent) => {
    const editor = resolveEditor(e.target)
    if (editor) {
      this.activeEditor = editor
    }
  }

  private onFocusOut = (_e: FocusEvent) => {
    // Delay so focus moving between the editor and a toolbar doesn't dismiss.
    setTimeout(() => {
      const active = document.activeElement as HTMLElement | null
      if (!active || !resolveEditor(active)) {
        this.dismiss()
        this.activeEditor = null
      }
    }, 50)
  }

  private onMouseDown = (e: MouseEvent) => {
    const ghost = (e.target as HTMLElement)?.closest?.('[data-copycat-ghost]')
    if (ghost !== null)
      return
    this.dismiss()
  }

  private onSelectionChange = () => {
    if (!this.active)
      return
    if (!this.activeEditor)
      return
    if (this.activeEditor.getPrefix() !== this.active.prefix) {
      this.dismiss()
    }
  }

  private onCompositionStart = () => {
    this.composing = true
    this.dismiss()
  }

  private onCompositionEnd = () => {
    this.composing = false
    this.scheduleRequest()
  }

  private onInput = (e: Event) => {
    if (this.composing)
      return
    const editor = resolveEditor(e.target)
    if (!editor)
      return
    this.activeEditor = editor

    if (this.active) {
      // Accept-by-typing: if user typed the next character(s) of the suggestion,
      // trim the ghost text rather than dismissing it entirely.
      const newPrefix = editor.getPrefix()
      if (newPrefix.startsWith(this.active.prefix)) {
        const typed = newPrefix.slice(this.active.prefix.length)
        if (typed && this.active.suggestion.startsWith(typed)) {
          const remaining = this.active.suggestion.slice(typed.length)
          if (!remaining) {
            this.dismiss('accepted')
          }
          else {
            this.active = {
              ...this.active,
              prefix: newPrefix,
              suggestion: remaining,
            }
            this.overlay.show(editor, remaining)
          }
          return
        }
      }
      this.dismiss()
    }
    this.scheduleRequest()
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (!this.active)
      return
    if (e.isComposing)
      return

    if (e.key === 'Tab') {
      e.preventDefault()
      e.stopPropagation()
      this.acceptActive()
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      this.dismiss('rejected')
      return
    }
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) {
      this.dismiss()
    }
  }

  private onReposition = () => {
    if (this.active && this.activeEditor) {
      this.overlay.show(this.activeEditor, this.active.suggestion)
    }
  }

  private scheduleRequest() {
    if (!this.settings)
      return
    if (!this.activeEditor)
      return
    if (this.composing)
      return

    const prefix = this.activeEditor.getPrefix()
    if (prefix.trim().length < this.settings.minPrefixChars) {
      this.dismiss()
      return
    }
    this.debouncedRequest()
  }

  private async requestCompletion() {
    if (!this.settings || !this.activeEditor)
      return
    const editor = this.activeEditor
    const prefix = editor.getPrefix()
    if (prefix.trim().length < this.settings.minPrefixChars) {
      this.pendingFingerprint = null
      this.lastRequestId = null
      return
    }
    const suffix = editor.getSuffix()
    const fingerprint = buildCompletionFingerprint({
      host: location.host,
      editorKind: editor.kind,
      prefix,
      suffix,
    })
    if (fingerprint === this.pendingFingerprint)
      return

    const id = nextId('req')
    this.lastRequestId = id
    this.pendingFingerprint = fingerprint
    const signalKey = buildCompletionSignalKey(location.host, editor.kind)

    const req: CompletionRequest = {
      id,
      prefix,
      suffix,
      signalKey,
      stage: 'fast',
    }

    try {
      const res = await sendRuntimeMessage<CompletionResponse>({
        type: 'completion/request',
        payload: req,
      })
      if (this.lastRequestId !== id)
        return
      this.pendingFingerprint = null
      if (res.completion.length === 0)
        return
      if (editor !== this.activeEditor)
        return
      if (editor.getPrefix() !== prefix)
        return

      this.active = {
        id,
        editor,
        latencyMs: res.latencyMs,
        originalSuggestion: res.completion,
        prefix,
        suggestion: res.completion,
      }
      this.overlay.show(editor, res.completion)

      if (shouldRequestEnhancedStage(res)) {
        void this.requestEnhancedCompletion({
          currentSuggestion: res.completion,
          editor,
          prefix,
          signalKey,
          suffix,
        })
      }
    }
    catch (err) {
      if (this.lastRequestId === id) {
        this.pendingFingerprint = null
        this.lastRequestId = null
      }
      if (!(err instanceof Error && /abort/i.test(err.message))) {
        console.warn('[copycat] completion error:', err)
      }
    }
  }

  private async requestEnhancedCompletion(args: {
    currentSuggestion: string
    editor: EditorHandle
    prefix: string
    signalKey: string
    suffix?: string
  }) {
    if (!this.settings)
      return

    const id = nextId('req')
    this.lastRequestId = id

    try {
      const res = await sendRuntimeMessage<CompletionResponse>({
        type: 'completion/request',
        payload: {
          id,
          prefix: args.prefix,
          suffix: args.suffix,
          signalKey: args.signalKey,
          stage: 'enhanced',
        },
      })

      if (this.lastRequestId !== id)
        return
      if (args.editor !== this.activeEditor)
        return
      if (args.editor.getPrefix() !== args.prefix)
        return
      if (!shouldPreferEnhancedCompletion(args.currentSuggestion, res.completion))
        return

      this.active = {
        id,
        editor: args.editor,
        latencyMs: res.latencyMs,
        originalSuggestion: res.completion,
        prefix: args.prefix,
        suggestion: res.completion,
      }
      this.overlay.show(args.editor, res.completion)
    }
    catch (err) {
      if (!(err instanceof Error && /abort/i.test(err.message))) {
        console.warn('[copycat] enhanced completion error:', err)
      }
    }
  }

  private acceptActive() {
    if (!this.active)
      return
    const active = this.active
    const { editor, suggestion } = active
    this.overlay.hide()
    this.active = null
    editor.insertAtCaret(suggestion)
    this.emitCompletionEvent(active, 'accepted')
  }

  private dismiss(action: CompletionEvent['action'] = 'ignored') {
    if (this.lastRequestId !== null) {
      void sendRuntimeMessage({ type: 'completion/cancel', payload: { id: this.lastRequestId } }).catch(
        () => {},
      )
      this.lastRequestId = null
    }
    this.pendingFingerprint = null
    this.debouncedRequest.cancel()
    if (this.active) {
      this.emitCompletionEvent(this.active, action)
      this.active = null
    }
    this.overlay.hide()
  }

  private emitCompletionEvent(
    active: ActiveSuggestion,
    action: CompletionEvent['action'],
  ) {
    const payload: CompletionEvent = {
      id: active.id,
      prefix: active.prefix,
      suggestion: active.originalSuggestion,
      action,
      latencyMs: active.latencyMs,
      timestamp: Date.now(),
      host: location.host,
    }

    void sendRuntimeMessage<void>({
      type: 'completion/event',
      payload,
    }).catch(() => {})
  }
}
