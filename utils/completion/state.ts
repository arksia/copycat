export type CompletionMode
  = | 'blocked'
    | 'idle'
    | 'requesting'
    | 'scheduled'
    | 'showing'

export interface CompletionSnapshot {
  editorId: string
  editorKind: string
  eligible: boolean
  fingerprint: string
  prefix: string
  revision: number
  selectionEnd: number
  selectionStart: number
  suffix: string
  value: string
}

export interface CompletionSession {
  fingerprint: string
  latencyMs: number | null
  originalSuggestion: string
  requestId: string | null
  sessionId: string
  snapshotRevision: number
  stage: 'enhanced' | 'fast'
  suggestion: string
}

export interface CompletionState {
  composeActive: boolean
  mode: CompletionMode
  snapshot: CompletionSnapshot | null
  session: CompletionSession | null
}

export type CompletionEvent
  = | {
    snapshot: CompletionSnapshot
    type: 'SNAPSHOT_UPDATED'
  }
    | {
      type: 'EDITOR_DEACTIVATED'
    }
    | {
      type: 'COMPOSITION_STARTED'
    }
    | {
      snapshot: CompletionSnapshot
      type: 'COMPOSITION_ENDED'
    }
    | {
      sessionId: string
      type: 'DEBOUNCE_ELAPSED'
    }
    | {
      requestId: string
      sessionId: string
      stage: 'enhanced' | 'fast'
      type: 'REQUEST_STARTED'
    }
    | {
      latencyMs: number
      originalSuggestion: string
      suggestion: string
      shouldRunEnhancedStage?: boolean
      stage: 'enhanced' | 'fast'
      type: 'REQUEST_RESOLVED'
      requestId: string
      sessionId: string
    }
    | {
      sessionId: string
      type: 'SUGGESTION_ACCEPTED'
    }
    | {
      sessionId: string
      type: 'SUGGESTION_REJECTED'
    }
    | {
      sessionId: string
      type: 'SESSION_CANCELLED'
    }
    | {
      snapshot: CompletionSnapshot
      sessionId: string
      type: 'REQUEST_SUPPRESSED'
    }

export type CompletionEffect
  = | {
    sessionId: string
    type: 'CANCEL_DEBOUNCE'
  }
    | {
      requestId: string | null
      sessionId: string
      type: 'CANCEL_REQUEST'
    }
    | {
      sessionId: string
      type: 'CLEAR_SUGGESTION'
    }
    | {
      sessionId: string
      type: 'EMIT_EVENT'
      action: 'accepted' | 'rejected'
      actualContinuation: string
      latencyMs: number
      prefix: string
      suggestion: string
    }
    | {
      sessionId: string
      stage: 'enhanced' | 'fast'
      type: 'REQUEST_COMPLETION'
    }
    | {
      sessionId: string
      type: 'SCHEDULE_DEBOUNCE'
    }
    | {
      originalSuggestion: string
      sessionId: string
      suggestion: string
      type: 'SHOW_SUGGESTION'
      latencyMs: number
      stage: 'enhanced' | 'fast'
    }

export interface CompletionTransition {
  effects: CompletionEffect[]
  state: CompletionState
}
