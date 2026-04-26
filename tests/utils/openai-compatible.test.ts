import { describe, expect, it } from 'vitest'
import {
  buildOpenAICompatibleHeaders,
  extractAssistantMessageContent,
  joinOpenAICompatibleUrl,
} from '~/utils/openai-compatible'

describe('joinOpenAICompatibleUrl', () => {
  it('normalizes slashes between the base url and path', () => {
    expect(joinOpenAICompatibleUrl('https://example.com/v1', '/models')).toBe(
      'https://example.com/v1/models',
    )
    expect(joinOpenAICompatibleUrl('https://example.com/v1/', 'chat/completions')).toBe(
      'https://example.com/v1/chat/completions',
    )
  })
})

describe('buildOpenAICompatibleHeaders', () => {
  it('always sends json content type', () => {
    expect(buildOpenAICompatibleHeaders('')).toEqual({
      'Content-Type': 'application/json',
    })
  })

  it('includes bearer auth when an api key is present', () => {
    expect(buildOpenAICompatibleHeaders('sk-test')).toEqual({
      'Content-Type': 'application/json',
      'Authorization': 'Bearer sk-test',
    })
  })
})

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
