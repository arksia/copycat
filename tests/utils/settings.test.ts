import type { Settings } from '~/types'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildDefaultSettings,
  buildDevSettingsOverride,
  DEFAULT_SETTINGS,
  hostMatches,
  isHostEnabled,
  loadSettings,
  normalizeSettingsShape,
  saveSettings,
} from '~/utils/settings'

const baseSettings: Settings = {
  enabled: true,
  provider: 'groq',
  baseUrl: 'https://api.groq.com/openai/v1',
  apiKey: '',
  model: 'llama-3.1-8b-instant',
  thinkingControlMode: 'auto',
  temperature: 0.2,
  maxTokens: 48,
  debounceMs: 300,
  minPrefixChars: 3,
  systemPrompt: 'test',
  soul: {
    enabled: false,
    learningEnabled: true,
    text: '',
  },
  enabledHosts: ['chatgpt.com'],
  disabledHosts: [],
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('hostMatches', () => {
  it('ships a system prompt with only global continuation rules', () => {
    expect(DEFAULT_SETTINGS.systemPrompt).toContain('Never answer the question or request in the prefix.')
    expect(DEFAULT_SETTINGS.systemPrompt).toContain('Only append continuation text to the same utterance.')
    expect(DEFAULT_SETTINGS.systemPrompt).toContain('Never switch from continuation mode into assistant reply mode.')
    expect(DEFAULT_SETTINGS.systemPrompt).toContain('If the continuation needs a connector or punctuation mark at the start, include it.')
    expect(DEFAULT_SETTINGS.systemPrompt).toContain('Output ONLY the requested result')
    expect(DEFAULT_SETTINGS.systemPrompt).not.toContain('__COPYCAT_SKIP__')
    expect(DEFAULT_SETTINGS.systemPrompt).not.toContain('Do not skip needed leading punctuation.')
  })

  it('matches exact hosts and subdomains', () => {
    expect(hostMatches('https://chatgpt.com', 'chatgpt.com')).toBe(true)
    expect(hostMatches('https://foo.chatgpt.com', 'chatgpt.com')).toBe(true)
    expect(hostMatches('https://example.com', 'chatgpt.com')).toBe(false)
  })
})

describe('isHostEnabled', () => {
  it('returns true for allowed hosts', () => {
    expect(isHostEnabled(baseSettings, 'https://chatgpt.com')).toBe(true)
  })

  it('returns false for disabled hosts even if allowed', () => {
    const settings = {
      ...baseSettings,
      disabledHosts: ['chatgpt.com'],
    }
    expect(isHostEnabled(settings, 'https://chatgpt.com')).toBe(false)
  })
})

describe('normalizeSettingsShape', () => {
  it('coerces legacy host lists into arrays', () => {
    const legacySettings = {
      enabledHosts: 'chatgpt.com\nclaude.ai',
      disabledHosts: 'example.com',
    } as unknown as Partial<Settings>

    expect(normalizeSettingsShape(legacySettings)).toMatchObject({
      enabledHosts: ['chatgpt.com', 'claude.ai'],
      disabledHosts: ['example.com'],
    })
  })

  it('falls back to defaults for invalid scalar values', () => {
    const invalidSettings = {
      provider: 'not-real',
      thinkingControlMode: 'bad-mode',
      maxTokens: 'bad',
      debounceMs: null,
      temperature: 'hot',
    } as unknown as Partial<Settings>

    expect(normalizeSettingsShape(invalidSettings)).toMatchObject({
      provider: DEFAULT_SETTINGS.provider,
      thinkingControlMode: DEFAULT_SETTINGS.thinkingControlMode,
      maxTokens: DEFAULT_SETTINGS.maxTokens,
      debounceMs: DEFAULT_SETTINGS.debounceMs,
      temperature: DEFAULT_SETTINGS.temperature,
    })
  })

  it('migrates legacy disableThinking booleans into the new thinking control mode', () => {
    expect(normalizeSettingsShape({
      disableThinking: true,
    } as unknown as Partial<Settings>).thinkingControlMode).toBe('auto')

    expect(normalizeSettingsShape({
      disableThinking: false,
    } as unknown as Partial<Settings>).thinkingControlMode).toBe('auto')
  })

  it('normalizes missing and invalid soul fields', () => {
    const invalidSettings = {
      soul: {
        enabled: 'yes',
        learningEnabled: 'no',
        text: '  builder\nconcise  ',
      },
    } as unknown as Partial<Settings>

    expect(normalizeSettingsShape(invalidSettings)).toMatchObject({
      soul: {
        enabled: false,
        learningEnabled: true,
        text: 'builder\nconcise',
      },
    })
  })

  it('migrates legacy structured soul profile fields into soul text', () => {
    const legacySettings = {
      soul: {
        enabled: true,
        learningEnabled: false,
        profile: {
          identity: '  builder  ',
          style: null,
          preferences: '  concise  ',
          avoidances: 123,
          terms: '  copycat, soul  ',
          notes: undefined,
        },
      },
    } as unknown as Partial<Settings>

    expect(normalizeSettingsShape(legacySettings)).toMatchObject({
      soul: {
        enabled: true,
        learningEnabled: false,
        text: 'builder\nconcise\ncopycat, soul',
      },
    })
  })
})

describe('buildDevSettingsOverride', () => {
  it('returns null when no dev env overrides are present', () => {
    vi.stubEnv('VITE_COPYCAT_PROVIDER', '')
    vi.stubEnv('VITE_COPYCAT_BASE_URL', '')
    vi.stubEnv('VITE_COPYCAT_MODEL', '')
    vi.stubEnv('VITE_COPYCAT_API_KEY', '')
    expect(buildDevSettingsOverride()).toBeNull()
  })

  it('builds a partial settings override from dev env values', () => {
    vi.stubEnv('VITE_COPYCAT_PROVIDER', 'openai')
    vi.stubEnv('VITE_COPYCAT_BASE_URL', 'https://api.minimaxi.com/v1')
    vi.stubEnv('VITE_COPYCAT_MODEL', 'MiniMax-Text-01')
    vi.stubEnv('VITE_COPYCAT_API_KEY', 'test-key')

    expect(buildDevSettingsOverride()).toEqual({
      provider: 'openai',
      baseUrl: 'https://api.minimaxi.com/v1',
      model: 'MiniMax-Text-01',
      apiKey: 'test-key',
    })
  })

  it('includes dev soul fields when soul env values are present', () => {
    vi.stubEnv('VITE_COPYCAT_SOUL_ENABLED', 'true')
    vi.stubEnv('VITE_COPYCAT_SOUL_LEARNING_ENABLED', 'false')
    vi.stubEnv('VITE_COPYCAT_SOUL_IDENTITY', 'A pragmatic extension engineer.')
    vi.stubEnv('VITE_COPYCAT_SOUL_STYLE', 'Direct and concise.')
    vi.stubEnv('VITE_COPYCAT_SOUL_PREFERENCES', 'Lead with the smallest workable implementation.')
    vi.stubEnv('VITE_COPYCAT_SOUL_AVOIDANCES', 'Avoid vague language.')
    vi.stubEnv('VITE_COPYCAT_SOUL_TERMS', 'ghost text\nsemantic recall')
    vi.stubEnv('VITE_COPYCAT_SOUL_NOTES', 'Prefer implementation detail over abstraction talk.')

    expect(buildDevSettingsOverride()).toMatchObject({
      soul: {
        enabled: true,
        learningEnabled: false,
        text: [
          'A pragmatic extension engineer.',
          'Direct and concise.',
          'Lead with the smallest workable implementation.',
          'Avoid vague language.',
          'ghost text\nsemantic recall',
          'Prefer implementation detail over abstraction talk.',
        ].join('\n'),
      },
    })
  })

  it('prefers dev soul text over legacy segmented env fields', () => {
    vi.stubEnv('VITE_COPYCAT_SOUL_TEXT', 'Write fixed Soul here.')
    vi.stubEnv('VITE_COPYCAT_SOUL_IDENTITY', 'Ignored identity.')

    expect(buildDevSettingsOverride()).toMatchObject({
      soul: {
        text: 'Write fixed Soul here.',
      },
    })
  })
})

describe('loadSettings', () => {
  it('applies the dev soul override when stored soul is still neutral', async () => {
    vi.stubEnv('VITE_COPYCAT_SOUL_ENABLED', 'true')
    vi.stubEnv('VITE_COPYCAT_SOUL_IDENTITY', 'A pragmatic extension engineer.')
    vi.stubEnv('VITE_COPYCAT_SOUL_PREFERENCES', 'Lead with the smallest workable implementation.')

    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: vi.fn().mockResolvedValue({
            'copycat:settings:v1': {
              enabled: true,
              soul: {
                enabled: false,
                learningEnabled: true,
                text: '',
              },
            },
          }),
        },
      },
    })

    const settings = await loadSettings()

    expect(settings.soul).toEqual({
      enabled: true,
      learningEnabled: true,
      text: 'A pragmatic extension engineer.\nLead with the smallest workable implementation.',
    })
  })
})

describe('saveSettings', () => {
  it('merges soul patches without clearing existing text', async () => {
    const current = buildDefaultSettings()
    current.soul.enabled = false
    current.soul.learningEnabled = true
    current.soul.text = 'builder\nconcise'

    const get = vi.fn().mockResolvedValue({
      'copycat:settings:v1': current,
    })
    const set = vi.fn().mockResolvedValue(undefined)

    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get,
          set,
        },
      },
    })

    const saved = await saveSettings({
      soul: {
        enabled: true,
        learningEnabled: false,
      },
    })

    expect(saved.soul).toEqual({
      enabled: true,
      learningEnabled: false,
      text: 'builder\nconcise',
    })
    expect(set).toHaveBeenCalledTimes(1)
  })
})
