import { describe, expect, it } from 'vitest'
import {
  buildCompletionFingerprint,
  buildCompletionSignalKey,
} from '~/utils/completion-request'

describe('buildCompletionSignalKey', () => {
  it('groups requests by host and editor kind', () => {
    expect(buildCompletionSignalKey('chatgpt.com', 'textarea')).toBe(
      'chatgpt.com::textarea',
    )
  })
})

describe('buildCompletionFingerprint', () => {
  it('changes when prefix changes', () => {
    const a = buildCompletionFingerprint({
      host: 'chatgpt.com',
      editorKind: 'textarea',
      prefix: 'hello',
      suffix: '',
    })
    const b = buildCompletionFingerprint({
      host: 'chatgpt.com',
      editorKind: 'textarea',
      prefix: 'hello world',
      suffix: '',
    })

    expect(a).not.toBe(b)
  })

  it('includes suffix so cursor movement can invalidate stale requests', () => {
    const a = buildCompletionFingerprint({
      host: 'chatgpt.com',
      editorKind: 'textarea',
      prefix: 'hello',
      suffix: ' world',
    })
    const b = buildCompletionFingerprint({
      host: 'chatgpt.com',
      editorKind: 'textarea',
      prefix: 'hello',
      suffix: '',
    })

    expect(a).not.toBe(b)
  })
})
