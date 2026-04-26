import type { Settings } from '~/types'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  completeOnceDetailed,
  extractRawCompletion,
  sanitizeCompletion,
} from '~/utils/llm'
import { DEFAULT_SYSTEM_PROMPT } from '~/utils/settings'

const baseSettings: Settings = {
  enabled: true,
  provider: 'custom',
  baseUrl: 'https://example.com/v1',
  apiKey: '',
  model: 'test-model',
  temperature: 0.2,
  maxTokens: 48,
  debounceMs: 300,
  minPrefixChars: 3,
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  enabledHosts: [],
  disabledHosts: [],
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('sanitizeCompletion', () => {
  it('strips echoed prefix and trailing whitespace', () => {
    expect(sanitizeCompletion('hello world  ', 'hello')).toBe(' world')
  })

  it('removes wrapping quotes from model output', () => {
    expect(sanitizeCompletion('"next step"', 'prefix')).toBe('next step')
  })
})

describe('dEFAULT_SYSTEM_PROMPT', () => {
  it('does not encourage empty completions for uncertain models', () => {
    expect(DEFAULT_SYSTEM_PROMPT.toLowerCase()).not.toContain('unsure')
  })
})

describe('extractRawCompletion', () => {
  it('returns assistant content when present', () => {
    expect(
      extractRawCompletion({
        message: { content: 'virtual machine' },
      }),
    ).toBe('virtual machine')
  })

  it('falls back to delta content when needed', () => {
    expect(extractRawCompletion({ delta: { content: 'next step' } })).toBe('next step')
  })
})

describe('completeOnceDetailed', () => {
  it('returns completion debug details for the request body', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: '主机环境',
            },
          },
        ],
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await completeOnceDetailed({
      prefix: '我想开发一个博客系统，首先需要使用虚拟',
      settings: baseSettings,
    })

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(String(init.body)) as {
      max_tokens: number
      model: string
      stream: boolean
      temperature: number
    }

    expect(body).toMatchObject({
      model: 'test-model',
      temperature: 0.2,
      max_tokens: 48,
      stream: false,
    })
    expect(result.completion).toBe('主机环境')
    expect(result.debug.requestBody.systemPrompt).toBe(DEFAULT_SYSTEM_PROMPT)
    expect(result.debug.requestBody.userPrompt).toContain('[Prefix]')
  })

  it('includes packed knowledge context in the user prompt when provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: '，并优化滚动体验。',
            },
          },
        ],
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await completeOnceDetailed({
      prefix: '我需要搭建一个个人网站，这个网站要使用虚拟列表',
      context: '[Virtual List Notes]\n虚拟列表适合处理长列表渲染和滚动性能问题。',
      settings: baseSettings,
    })

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(String(init.body)) as {
      messages: Array<{ content: string, role: string }>
    }

    expect(body.messages[1]?.content).toContain('[Knowledge]')
    expect(body.messages[1]?.content).toContain('Virtual List Notes')
  })
})
