import { describe, expect, it } from 'vitest'
import {
  extractAssistantMessageContent,
} from '~/utils/openai-compatible'

describe('extractAssistantMessageContent', () => {
  it('returns the first assistant content string when present', () => {
    expect(
      extractAssistantMessageContent({
        choices: [
          {
            message: {
              content: 'ok',
            },
          },
        ],
      }),
    ).toBe('ok')
  })

  it('returns an empty string for malformed payloads', () => {
    expect(extractAssistantMessageContent({})).toBe('')
    expect(extractAssistantMessageContent(null)).toBe('')
  })
})
