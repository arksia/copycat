import { describe, expect, it } from 'vitest'
import { reduceCompletionState } from '~/utils/completion/reducer'
import type { CompletionSnapshot, CompletionState } from '~/utils/completion/state'

function buildSnapshot(overrides: Partial<CompletionSnapshot> = {}): CompletionSnapshot {
  return {
    editorId: 'editor-1',
    editorKind: 'textarea',
    eligible: true,
    fingerprint: 'fp-1',
    prefix: 'hello',
    revision: 1,
    selectionEnd: 5,
    selectionStart: 5,
    suffix: '',
    value: 'hello',
    ...overrides,
  }
}

function buildState(overrides: Partial<CompletionState> = {}): CompletionState {
  return {
    composeActive: false,
    mode: 'idle',
    snapshot: null,
    session: null,
    ...overrides,
  }
}

describe('reduceCompletionState', () => {
  it('schedules a new session when an eligible snapshot arrives', () => {
    const snapshot = buildSnapshot()

    const result = reduceCompletionState(buildState(), {
      snapshot,
      type: 'SNAPSHOT_UPDATED',
    })

    expect(result.state.mode).toBe('scheduled')
    expect(result.state.snapshot).toEqual(snapshot)
    expect(result.state.session?.fingerprint).toBe(snapshot.fingerprint)
    expect(result.effects).toEqual([
      {
        sessionId: 'sess_1',
        type: 'SCHEDULE_DEBOUNCE',
      },
    ])
  })

  it('blocks and clears an existing session when the snapshot becomes ineligible', () => {
    const state = buildState({
      mode: 'showingFast',
      snapshot: buildSnapshot(),
      session: {
        fingerprint: 'fp-1',
        latencyMs: 120,
        originalSuggestion: ' world',
        requestId: 'req-1',
        sessionId: 'sess_1',
        snapshotRevision: 1,
        stage: 'fast',
        suggestion: ' world',
      },
    })
    const snapshot = buildSnapshot({
      eligible: false,
      revision: 2,
      selectionEnd: 2,
      selectionStart: 2,
      suffix: 'llo',
    })

    const result = reduceCompletionState(state, {
      snapshot,
      type: 'SNAPSHOT_UPDATED',
    })

    expect(result.state.mode).toBe('blocked')
    expect(result.state.session).toBeNull()
    expect(result.effects).toEqual([
      {
        requestId: 'req-1',
        sessionId: 'sess_1',
        type: 'CANCEL_REQUEST',
      },
      {
        sessionId: 'sess_1',
        type: 'CANCEL_DEBOUNCE',
      },
      {
        sessionId: 'sess_1',
        type: 'CLEAR_SUGGESTION',
      },
      {
        action: 'ignored',
        latencyMs: 120,
        prefix: 'hello',
        sessionId: 'sess_1',
        suggestion: ' world',
        type: 'EMIT_EVENT',
      },
    ])
  })

  it('ignores a debounce event for a stale session', () => {
    const state = buildState({
      mode: 'scheduled',
      snapshot: buildSnapshot(),
      session: {
        fingerprint: 'fp-1',
        latencyMs: null,
        originalSuggestion: '',
        requestId: null,
        sessionId: 'sess_1',
        snapshotRevision: 1,
        stage: 'fast',
        suggestion: '',
      },
    })

    const result = reduceCompletionState(state, {
      sessionId: 'sess_old',
      type: 'DEBOUNCE_ELAPSED',
    })

    expect(result.state).toEqual(state)
    expect(result.effects).toEqual([])
  })

  it('emits a fast request when the active scheduled session debounce elapses', () => {
    const state = buildState({
      mode: 'scheduled',
      snapshot: buildSnapshot(),
      session: {
        fingerprint: 'fp-1',
        latencyMs: null,
        originalSuggestion: '',
        requestId: null,
        sessionId: 'sess_1',
        snapshotRevision: 1,
        stage: 'fast',
        suggestion: '',
      },
    })

    const result = reduceCompletionState(state, {
      sessionId: 'sess_1',
      type: 'DEBOUNCE_ELAPSED',
    })

    expect(result.state.mode).toBe('requestingFast')
    expect(result.effects).toEqual([
      {
        sessionId: 'sess_1',
        stage: 'fast',
        type: 'REQUEST_COMPLETION',
      },
    ])
  })

  it('moves to blocked and clears the session when composition starts', () => {
    const state = buildState({
      mode: 'showingFast',
      snapshot: buildSnapshot(),
      session: {
        fingerprint: 'fp-1',
        latencyMs: 120,
        originalSuggestion: ' world',
        requestId: 'req-1',
        sessionId: 'sess_1',
        snapshotRevision: 1,
        stage: 'fast',
        suggestion: ' world',
      },
    })

    const result = reduceCompletionState(state, {
      type: 'COMPOSITION_STARTED',
    })

    expect(result.state.composeActive).toBe(true)
    expect(result.state.mode).toBe('blocked')
    expect(result.state.session).toBeNull()
    expect(result.effects).toEqual([
      {
        requestId: 'req-1',
        sessionId: 'sess_1',
        type: 'CANCEL_REQUEST',
      },
      {
        sessionId: 'sess_1',
        type: 'CANCEL_DEBOUNCE',
      },
      {
        sessionId: 'sess_1',
        type: 'CLEAR_SUGGESTION',
      },
      {
        action: 'ignored',
        latencyMs: 120,
        prefix: 'hello',
        sessionId: 'sess_1',
        suggestion: ' world',
        type: 'EMIT_EVENT',
      },
    ])
  })

  it('returns to idle and clears the session when the editor deactivates', () => {
    const state = buildState({
      mode: 'showingFast',
      snapshot: buildSnapshot(),
      session: {
        fingerprint: 'fp-1',
        latencyMs: 120,
        originalSuggestion: ' world',
        requestId: 'req-1',
        sessionId: 'sess_1',
        snapshotRevision: 1,
        stage: 'fast',
        suggestion: ' world',
      },
    })

    const result = reduceCompletionState(state, {
      type: 'EDITOR_DEACTIVATED',
    })

    expect(result.state.composeActive).toBe(false)
    expect(result.state.mode).toBe('idle')
    expect(result.state.snapshot).toBeNull()
    expect(result.state.session).toBeNull()
    expect(result.effects).toEqual([
      {
        requestId: 'req-1',
        sessionId: 'sess_1',
        type: 'CANCEL_REQUEST',
      },
      {
        sessionId: 'sess_1',
        type: 'CANCEL_DEBOUNCE',
      },
      {
        sessionId: 'sess_1',
        type: 'CLEAR_SUGGESTION',
      },
      {
        action: 'ignored',
        latencyMs: 120,
        prefix: 'hello',
        sessionId: 'sess_1',
        suggestion: ' world',
        type: 'EMIT_EVENT',
      },
    ])
  })
})
