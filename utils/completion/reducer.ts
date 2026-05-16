import { shouldPreferEnhancedCompletion } from './staging'
import type {
  CompletionEffect,
  CompletionEvent,
  CompletionSession,
  CompletionState,
  CompletionTransition,
} from './state'

function createSession(args: {
  fingerprint: string
  sessionId: string
  snapshotRevision: number
}): CompletionSession {
  return {
    fingerprint: args.fingerprint,
    latencyMs: null,
    originalSuggestion: '',
    requestId: null,
    sessionId: args.sessionId,
    snapshotRevision: args.snapshotRevision,
    stage: 'fast',
    suggestion: '',
  }
}

function buildBlockedTransition(
  state: CompletionState,
  nextState: CompletionState,
): CompletionTransition {
  const effects: CompletionEffect[] = []
  if (state.session) {
    effects.push({
      requestId: state.session.requestId,
      sessionId: state.session.sessionId,
      type: 'CANCEL_REQUEST',
    })
    effects.push({
      sessionId: state.session.sessionId,
      type: 'CANCEL_DEBOUNCE',
    })
    effects.push({
      sessionId: state.session.sessionId,
      type: 'CLEAR_SUGGESTION',
    })
    if (state.session.suggestion) {
      effects.push({
        action: 'ignored',
        latencyMs: state.session.latencyMs ?? 0,
        prefix: state.snapshot?.prefix ?? '',
        sessionId: state.session.sessionId,
        suggestion: state.session.originalSuggestion || state.session.suggestion,
        type: 'EMIT_EVENT',
      })
    }
  }
  return {
    effects,
    state: nextState,
  }
}

export function reduceCompletionState(
  state: CompletionState,
  event: CompletionEvent,
): CompletionTransition {
  switch (event.type) {
    case 'EDITOR_DEACTIVATED': {
      if (!state.session) {
        return {
          effects: [],
          state: {
            ...state,
            composeActive: false,
            mode: 'idle',
            snapshot: null,
            session: null,
          },
        }
      }

      return buildBlockedTransition(state, {
        ...state,
        composeActive: false,
        mode: 'idle',
        snapshot: null,
        session: null,
      })
    }

    case 'COMPOSITION_STARTED': {
      return buildBlockedTransition(state, {
        ...state,
        composeActive: true,
        mode: 'blocked',
        session: null,
      })
    }

    case 'COMPOSITION_ENDED': {
      return reduceCompletionState({
        ...state,
        composeActive: false,
      }, {
        snapshot: {
          ...event.snapshot,
          eligible: event.snapshot.eligible,
        },
        type: 'SNAPSHOT_UPDATED',
      })
    }

    case 'SNAPSHOT_UPDATED': {
      if (state.composeActive) {
        return {
          effects: [],
          state: {
            ...state,
            mode: 'blocked',
            snapshot: event.snapshot,
          },
        }
      }

      if (!event.snapshot.eligible) {
        return buildBlockedTransition(state, {
          ...state,
          mode: 'blocked',
          snapshot: event.snapshot,
          session: null,
        })
      }

      if (
        state.snapshot
        && state.session
        && state.snapshot.fingerprint === event.snapshot.fingerprint
        && state.snapshot.editorId === event.snapshot.editorId
      ) {
        return {
          effects: [],
          state: {
            ...state,
            snapshot: event.snapshot,
            session: {
              ...state.session,
              snapshotRevision: event.snapshot.revision,
            },
          },
        }
      }

      const nextSession = createSession({
        fingerprint: event.snapshot.fingerprint,
        sessionId: `sess_${event.snapshot.revision}`,
        snapshotRevision: event.snapshot.revision,
      })
      const effects: CompletionEffect[] = []
      if (state.session) {
        effects.push({
          requestId: state.session.requestId,
          sessionId: state.session.sessionId,
          type: 'CANCEL_REQUEST',
        })
        effects.push({
          sessionId: state.session.sessionId,
          type: 'CANCEL_DEBOUNCE',
        })
        effects.push({
          sessionId: state.session.sessionId,
          type: 'CLEAR_SUGGESTION',
        })
      }
      effects.push({
        sessionId: nextSession.sessionId,
        type: 'SCHEDULE_DEBOUNCE',
      })
      return {
        effects,
        state: {
          ...state,
          mode: 'scheduled',
          snapshot: event.snapshot,
          session: nextSession,
        },
      }
    }

    case 'DEBOUNCE_ELAPSED': {
      if (state.mode !== 'scheduled' || !state.session || state.session.sessionId !== event.sessionId) {
        return { effects: [], state }
      }

      return {
        effects: [{
          sessionId: state.session.sessionId,
          stage: 'fast',
          type: 'REQUEST_COMPLETION',
        }],
        state: {
          ...state,
          mode: 'requestingFast',
        },
      }
    }

    case 'FAST_REQUEST_STARTED': {
      if (!state.session || state.session.sessionId !== event.sessionId) {
        return { effects: [], state }
      }
      return {
        effects: [],
        state: {
          ...state,
          mode: 'requestingFast',
          session: {
            ...state.session,
            requestId: event.requestId,
            stage: 'fast',
          },
        },
      }
    }

    case 'FAST_REQUEST_RESOLVED': {
      if (
        !state.session
        || state.session.sessionId !== event.sessionId
        || state.session.requestId !== event.requestId
      ) {
        return { effects: [], state }
      }

      const nextSession: CompletionSession = {
        ...state.session,
        latencyMs: event.latencyMs,
        originalSuggestion: event.originalSuggestion,
        requestId: null,
        stage: 'fast',
        suggestion: event.suggestion,
      }

      const effects: CompletionEffect[] = []
      if (event.suggestion) {
        effects.push({
          latencyMs: event.latencyMs,
          originalSuggestion: event.originalSuggestion,
          sessionId: state.session.sessionId,
          stage: 'fast',
          suggestion: event.suggestion,
          type: 'SHOW_SUGGESTION',
        })
      }
      if (event.shouldRunEnhancedStage) {
        effects.push({
          currentSuggestion: event.originalSuggestion,
          sessionId: state.session.sessionId,
          stage: 'enhanced',
          type: 'REQUEST_COMPLETION',
        })
      }

      return {
        effects,
        state: {
          ...state,
          mode: event.suggestion ? 'showingFast' : 'idle',
          session: event.suggestion ? nextSession : null,
        },
      }
    }

    case 'ENHANCED_REQUEST_STARTED': {
      if (!state.session || state.session.sessionId !== event.sessionId) {
        return { effects: [], state }
      }
      return {
        effects: [],
        state: {
          ...state,
          mode: 'requestingEnhanced',
          session: {
            ...state.session,
            requestId: event.requestId,
            stage: 'enhanced',
          },
        },
      }
    }

    case 'ENHANCED_REQUEST_RESOLVED': {
      if (
        !state.session
        || state.session.sessionId !== event.sessionId
        || state.session.requestId !== event.requestId
      ) {
        return { effects: [], state }
      }

      if (!shouldPreferEnhancedCompletion(state.session.suggestion, event.suggestion)) {
        return {
          effects: [],
          state: {
            ...state,
            mode: state.session.suggestion ? 'showingFast' : 'idle',
            session: {
              ...state.session,
              requestId: null,
            },
          },
        }
      }

      const nextSession: CompletionSession = {
        ...state.session,
        latencyMs: event.latencyMs,
        originalSuggestion: event.originalSuggestion,
        requestId: null,
        stage: 'enhanced',
        suggestion: event.suggestion,
      }

      return {
        effects: [{
          latencyMs: event.latencyMs,
          originalSuggestion: event.originalSuggestion,
          sessionId: state.session.sessionId,
          stage: 'enhanced',
          suggestion: event.suggestion,
          type: 'SHOW_SUGGESTION',
        }],
        state: {
          ...state,
          mode: 'showingEnhanced',
          session: nextSession,
        },
      }
    }

    case 'SUGGESTION_ACCEPTED': {
      if (!state.session || state.session.sessionId !== event.sessionId || !state.snapshot) {
        return { effects: [], state }
      }
      return {
        effects: [{
          action: 'accepted',
          latencyMs: state.session.latencyMs ?? 0,
          prefix: state.snapshot.prefix,
          sessionId: state.session.sessionId,
          suggestion: state.session.originalSuggestion || state.session.suggestion,
          type: 'EMIT_EVENT',
        }, {
          sessionId: state.session.sessionId,
          type: 'CLEAR_SUGGESTION',
        }],
        state: {
          ...state,
          mode: 'idle',
          session: null,
        },
      }
    }

    case 'SUGGESTION_REJECTED':
    case 'SESSION_CANCELLED': {
      if (!state.session || state.session.sessionId !== event.sessionId || !state.snapshot) {
        return { effects: [], state }
      }
      const action = event.type === 'SUGGESTION_REJECTED' ? 'rejected' : 'ignored'
      return {
        effects: [{
          action,
          latencyMs: state.session.latencyMs ?? 0,
          prefix: state.snapshot.prefix,
          sessionId: state.session.sessionId,
          suggestion: state.session.originalSuggestion || state.session.suggestion,
          type: 'EMIT_EVENT',
        }, {
          sessionId: state.session.sessionId,
          type: 'CLEAR_SUGGESTION',
        }],
        state: {
          ...state,
          mode: 'idle',
          session: null,
        },
      }
    }
  }
}
