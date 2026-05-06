import type { Settings, SettingsPatch, SoulProfile, SoulSettings } from '~/types'
import { PROVIDER_PRESETS } from './providers'

const STORAGE_KEY = 'copycat:settings:v1'
const DEFAULT_SOUL_PROFILE: SoulProfile = {
  identity: '',
  style: '',
  preferences: '',
  avoidances: '',
  terms: '',
  notes: '',
}

const DEFAULT_SOUL_SETTINGS: SoulSettings = {
  enabled: false,
  profile: { ...DEFAULT_SOUL_PROFILE },
}

/**
 * Default system prompt for inline autocomplete requests.
 *
 * Use when:
 * - initializing extension settings
 * - resetting the prompt back to the product default
 *
 * Expects:
 * - the target model accepts a standard chat-completions style system prompt
 *
 * Returns:
 * - a short instruction set that biases the model toward continuation-only output
 */
export const DEFAULT_SYSTEM_PROMPT = `You are an inline autocomplete engine for an AI chat input box.
Given the user's partially written message (prefix), continue it with ONE short, natural continuation
in the SAME language as the prefix. Rules:
- Output ONLY the continuation text, with NO quotes, NO markdown, NO explanations.
- Do NOT repeat the prefix.
- Keep it short: a few words up to one sentence.
- Preserve tone and register. Never add trailing whitespace.`

/**
 * Default extension settings used when no stored configuration exists.
 *
 * Use when:
 * - bootstrapping a fresh install
 * - resetting the extension configuration
 *
 * Expects:
 * - provider presets to supply neutral defaults for base URL and model
 *
 * Returns:
 * - a complete settings object safe to persist into local storage
 */
export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  provider: 'groq',
  baseUrl: PROVIDER_PRESETS.groq.baseUrl,
  apiKey: '',
  model: PROVIDER_PRESETS.groq.defaultModel,
  temperature: 0.2,
  maxTokens: 48,
  debounceMs: 300,
  minPrefixChars: 3,
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  soul: {
    enabled: DEFAULT_SOUL_SETTINGS.enabled,
    profile: { ...DEFAULT_SOUL_PROFILE },
  },
  enabledHosts: [
    'chatgpt.com',
    'chat.openai.com',
    'claude.ai',
    'gemini.google.com',
    'poe.com',
    'chat.deepseek.com',
    'chat.qwen.ai',
    'yuanbao.tencent.com',
    'kimi.com',
    'chatglm.cn',
  ],
  disabledHosts: [],
}

/**
 * Builds a fresh default settings object without sharing nested references.
 *
 * Use when:
 * - UI state should be reset from defaults
 * - callers must avoid mutating the exported `DEFAULT_SETTINGS` object graph
 *
 * Returns:
 * - a new settings object with cloned nested arrays and Soul profile fields
 */
export function buildDefaultSettings(): Settings {
  return {
    ...DEFAULT_SETTINGS,
    soul: {
      enabled: DEFAULT_SOUL_SETTINGS.enabled,
      profile: { ...DEFAULT_SOUL_PROFILE },
    },
    enabledHosts: DEFAULT_SETTINGS.enabledHosts.slice(),
    disabledHosts: DEFAULT_SETTINGS.disabledHosts.slice(),
  }
}

/**
 * Builds a local development settings override from environment variables.
 *
 * Use when:
 * - developers want a prefilled local backend during `pnpm dev`
 * - secrets should stay outside git while still seeding first-run settings
 *
 * Expects:
 * - Vite-prefixed env vars when local defaults should be overridden
 *
 * Returns:
 * - a partial settings object, or `null` when no override is configured
 */
export function buildDevSettingsOverride(): Partial<Settings> | null {
  const provider = import.meta.env.VITE_COPYCAT_PROVIDER
  const baseUrl = import.meta.env.VITE_COPYCAT_BASE_URL
  const model = import.meta.env.VITE_COPYCAT_MODEL
  const apiKey = import.meta.env.VITE_COPYCAT_API_KEY

  const next: Partial<Settings> = {}

  if (isProviderId(provider)) {
    next.provider = provider
  }
  if (typeof baseUrl === 'string' && baseUrl.length > 0) {
    next.baseUrl = baseUrl
  }
  if (typeof model === 'string' && model.length > 0) {
    next.model = model
  }
  if (typeof apiKey === 'string' && apiKey.length > 0) {
    next.apiKey = apiKey
  }

  return Object.keys(next).length > 0 ? next : null
}

/**
 * Loads the persisted settings object from extension local storage.
 *
 * Use when:
 * - an extension surface needs the effective runtime settings
 * - background or UI code needs normalized configuration values
 *
 * Expects:
 * - settings to be stored under the shared storage key when previously saved
 *
 * Returns:
 * - the normalized effective settings object
 */
export async function loadSettings(): Promise<Settings> {
  const raw = await chrome.storage.local.get(STORAGE_KEY)
  const stored = (raw[STORAGE_KEY] ?? {}) as Partial<Settings>
  const devOverride = buildDevSettingsOverride()
  return normalizeSettingsShape(devOverride === null ? stored : { ...devOverride, ...stored })
}

/**
 * Merges a partial settings patch into the persisted extension settings.
 *
 * Use when:
 * - an extension surface updates one or more settings fields
 * - callers want the normalized persisted result after saving
 *
 * Expects:
 * - `patch` to contain only settings fields that should change
 *
 * Returns:
 * - the normalized settings object that was written to local storage
 */
export async function saveSettings(patch: SettingsPatch): Promise<Settings> {
  const current = await loadSettings()
  const next = normalizeSettingsShape(mergeSettingsPatch(current, patch))
  await chrome.storage.local.set({ [STORAGE_KEY]: next })
  return next
}

/**
 * Subscribes to settings changes from extension local storage.
 *
 * Use when:
 * - a UI surface should react to settings changes made elsewhere
 * - long-lived runtime code needs to stay in sync with persisted settings
 *
 * Expects:
 * - `handler` to accept an already-normalized settings object
 *
 * Returns:
 * - an unsubscribe function that removes the storage listener
 */
export function onSettingsChanged(handler: (next: Settings) => void): () => void {
  const listener = (
    changes: Record<string, chrome.storage.StorageChange>,
    area: chrome.storage.AreaName,
  ) => {
    if (area !== 'local' || !(STORAGE_KEY in changes))
      return
    const next = normalizeSettingsShape((changes[STORAGE_KEY].newValue ?? {}) as Partial<Settings>)
    handler(next)
  }
  chrome.storage.onChanged.addListener(listener)
  return () => chrome.storage.onChanged.removeListener(listener)
}

/**
 * Normalizes a partial stored settings object into the full runtime shape.
 *
 * Before:
 * - `{ provider: 'not-real', enabledHosts: 'chatgpt.com\\nclaude.ai', maxTokens: 'bad' }`
 *
 * After:
 * - `{ provider: 'groq', enabledHosts: ['chatgpt.com', 'claude.ai'], maxTokens: 48, ... }`
 */
export function normalizeSettingsShape(stored: Partial<Settings>): Settings {
  return {
    ...buildDefaultSettings(),
    ...stored,
    provider: isProviderId(stored.provider) ? stored.provider : DEFAULT_SETTINGS.provider,
    soul: normalizeSoulSettings(stored.soul),
    enabledHosts: normalizeHostList(stored.enabledHosts, DEFAULT_SETTINGS.enabledHosts),
    disabledHosts: normalizeHostList(stored.disabledHosts, DEFAULT_SETTINGS.disabledHosts),
    maxTokens: normalizeNumber(stored.maxTokens, DEFAULT_SETTINGS.maxTokens),
    debounceMs: normalizeNumber(stored.debounceMs, DEFAULT_SETTINGS.debounceMs),
    minPrefixChars: normalizeNumber(stored.minPrefixChars, DEFAULT_SETTINGS.minPrefixChars),
    temperature: normalizeNumber(stored.temperature, DEFAULT_SETTINGS.temperature),
  }
}

function isProviderId(value: unknown): value is Settings['provider'] {
  return typeof value === 'string' && value in PROVIDER_PRESETS
}

function normalizeHostList(value: unknown, fallback: string[]): string[] {
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === 'string')
      .map(item => item.trim())
      .filter(Boolean)
  }
  if (typeof value === 'string') {
    return value
      .split(/\r?\n/)
      .map(item => item.trim())
      .filter(Boolean)
  }
  return fallback.slice()
}

function normalizeNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function normalizeSoulSettings(value: unknown): SoulSettings {
  if (typeof value !== 'object' || value === null) {
    return {
      enabled: DEFAULT_SOUL_SETTINGS.enabled,
      profile: { ...DEFAULT_SOUL_PROFILE },
    }
  }

  const raw = value as Partial<SoulSettings>
  return {
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : DEFAULT_SOUL_SETTINGS.enabled,
    profile: normalizeSoulProfile(raw.profile),
  }
}

function normalizeSoulProfile(value: unknown): SoulProfile {
  if (typeof value !== 'object' || value === null) {
    return { ...DEFAULT_SOUL_PROFILE }
  }

  const raw = value as Partial<SoulProfile>
  return {
    identity: normalizeSoulField(raw.identity),
    style: normalizeSoulField(raw.style),
    preferences: normalizeSoulField(raw.preferences),
    avoidances: normalizeSoulField(raw.avoidances),
    terms: normalizeSoulField(raw.terms),
    notes: normalizeSoulField(raw.notes),
  }
}

function normalizeSoulField(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function mergeSettingsPatch(current: Settings, patch: SettingsPatch): Partial<Settings> {
  return {
    ...current,
    ...patch,
    soul: patch.soul === undefined
      ? current.soul
      : {
          ...current.soul,
          ...patch.soul,
          profile: patch.soul.profile === undefined
            ? current.soul.profile
            : {
                ...current.soul.profile,
                ...patch.soul.profile,
              },
        },
  }
}

/**
 * Checks whether a URL belongs to the target host or one of its subdomains.
 *
 * Before:
 * - `url = "https://foo.chatgpt.com/a"`, `host = "chatgpt.com"`
 *
 * After:
 * - `true`
 */
export function hostMatches(url: string, host: string): boolean {
  try {
    const u = new URL(url)
    return u.hostname === host || u.hostname.endsWith(`.${host}`)
  }
  catch {
    return false
  }
}

/**
 * Computes whether Copycat should run on the given URL under the current settings.
 *
 * Use when:
 * - content-script or popup code needs the effective site enablement state
 * - disabled hosts should override enabled host patterns
 *
 * Expects:
 * - `settings` to already be normalized
 * - `url` to be the current page URL when available
 *
 * Returns:
 * - `true` when the extension is globally enabled and the host passes the allow/deny rules
 */
export function isHostEnabled(settings: Settings, url: string): boolean {
  if (!settings.enabled)
    return false
  if (settings.disabledHosts.some(h => hostMatches(url, h)))
    return false
  if (settings.enabledHosts.length === 0)
    return true
  return settings.enabledHosts.some(h => hostMatches(url, h))
}
