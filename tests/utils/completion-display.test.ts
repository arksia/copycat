import { describe, expect, it } from 'vitest'
import { getDisplayCompletion } from '~/utils/completion/display'

describe('getDisplayCompletion', () => {
  it('trims the overlapping tail that already exists after the caret', () => {
    expect(getDisplayCompletion('ats very much', ' very much')).toBe('ats')
  })

  it('returns an empty string when the suffix already contains the full suggestion tail', () => {
    expect(getDisplayCompletion(' very much', ' very much')).toBe('')
  })

  it('leaves the suggestion unchanged when there is no suffix overlap', () => {
    expect(getDisplayCompletion('ats quickly', ' later')).toBe('ats quickly')
  })
})
