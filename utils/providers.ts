import type { ProviderId, ProviderPreset } from '~/types'

/**
 * Built-in provider presets shown in the settings UI.
 *
 * Use when:
 * - populating provider choices
 * - applying neutral default base URLs and models
 *
 * Expects:
 * - custom providers to be configured by the user rather than by a committed preset
 *
 * Returns:
 * - the canonical preset map keyed by provider id
 */
export const PROVIDER_PRESETS: Record<ProviderId, ProviderPreset> = {
  groq: {
    id: 'groq',
    name: 'Groq (recommended)',
    baseUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.1-8b-instant',
    requiresKey: true,
    docsUrl: 'https://console.groq.com/keys',
  },
  openai: {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    requiresKey: true,
    docsUrl: 'https://platform.openai.com/api-keys',
  },
  deepseek: {
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    requiresKey: true,
    docsUrl: 'https://platform.deepseek.com/api_keys',
  },
  ollama: {
    id: 'ollama',
    name: 'Ollama (local)',
    baseUrl: 'http://localhost:11434/v1',
    defaultModel: 'qwen2.5:1.5b',
    requiresKey: false,
    docsUrl: 'https://ollama.com',
  },
  custom: {
    id: 'custom',
    name: 'Custom (OpenAI-compatible)',
    baseUrl: '',
    defaultModel: '',
    requiresKey: false,
  },
}

/**
 * Stable provider ordering for settings and picker UIs.
 */
export const PROVIDER_ORDER: ProviderId[] = ['groq', 'openai', 'deepseek', 'ollama', 'custom']

/**
 * Resolves a provider id into the matching preset, falling back to `custom`.
 *
 * Use when:
 * - a settings surface needs the preset metadata for the current provider
 *
 * Expects:
 * - `providerId` to come from normalized settings in normal flows
 *
 * Returns:
 * - the matching preset or the custom fallback preset
 */
export function resolveProviderPreset(providerId: ProviderId): ProviderPreset {
  return PROVIDER_PRESETS[providerId] ?? PROVIDER_PRESETS.custom
}
