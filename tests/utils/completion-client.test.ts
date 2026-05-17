import { describe, expect, it } from 'vitest'
import {
  COMPLETION_SKIP_SENTINEL,
  normalizeCompletion,
} from '~/utils/completion/client'

describe('normalizeCompletion', () => {
  it('treats the skip sentinel as an explicit skip', () => {
    expect(normalizeCompletion(COMPLETION_SKIP_SENTINEL)).toEqual({
      completion: '',
      skipped: true,
      skipReason: 'sentinel',
    })
  })

  it('treats empty and whitespace completions as skips', () => {
    expect(normalizeCompletion('')).toEqual({
      completion: '',
      skipped: true,
      skipReason: 'empty',
    })

    expect(normalizeCompletion('   \n\t')).toEqual({
      completion: '',
      skipped: true,
      skipReason: 'whitespace',
    })
  })

  it('preserves a non-empty completion', () => {
    expect(normalizeCompletion('，先把触发频率降下来。')).toEqual({
      completion: '，先把触发频率降下来。',
      skipped: false,
    })
  })
})
