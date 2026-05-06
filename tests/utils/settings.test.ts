import type { Settings } from '~/types'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_SETTINGS,
  buildDefaultSettings,
  buildDevSettingsOverride,
  hostMatches,
  isHostEnabled,
  normalizeSettingsShape,
  saveSettings,
} from '~/utils/settings'

const baseSettings: Settings = {
  enabled: true,
  provider: 'groq',
  baseUrl: 'https://api.groq.com/openai/v1',
  apiKey: '',
  model: 'llama-3.1-8b-instant',
  temperature: 0.2,
  maxTokens: 48,
  debounceMs: 300,
  minPrefixChars: 3,
  systemPrompt: 'test',
  soul: {
    enabled: false,
    profile: {
      identity: '',
      style: '',
      preferences: '',
      avoidances: '',
      terms: '',
      notes: '',
    },
  },
  enabledHosts: ['chatgpt.com'],
  disabledHosts: [],
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('hostMatches', () => {
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
      maxTokens: 'bad',
      debounceMs: null,
      temperature: 'hot',
    } as unknown as Partial<Settings>

    expect(normalizeSettingsShape(invalidSettings)).toMatchObject({
      provider: DEFAULT_SETTINGS.provider,
      maxTokens: DEFAULT_SETTINGS.maxTokens,
      debounceMs: DEFAULT_SETTINGS.debounceMs,
      temperature: DEFAULT_SETTINGS.temperature,
    })
  })

  it('normalizes missing and invalid soul fields', () => {
    const invalidSettings = {
      soul: {
        enabled: 'yes',
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

    expect(normalizeSettingsShape(invalidSettings)).toMatchObject({
      soul: {
        enabled: false,
        profile: {
          identity: 'builder',
          style: '',
          preferences: 'concise',
          avoidances: '',
          terms: 'copycat, soul',
          notes: '',
        },
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
})

describe('saveSettings', () => {
  it('deep-merges nested soul patches without clearing the existing profile', async () => {
    const current = buildDefaultSettings()
    current.soul.enabled = false
    current.soul.profile.identity = 'builder'
    current.soul.profile.preferences = 'concise'

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
      },
    })

    expect(saved.soul).toEqual({
      enabled: true,
      profile: {
        identity: 'builder',
        style: '',
        preferences: 'concise',
        avoidances: '',
        terms: '',
        notes: '',
      },
    })
    expect(set).toHaveBeenCalledTimes(1)
  })
})
