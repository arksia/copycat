import type { ProviderId, ProviderPreset } from '~/types';

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
    baseUrl: 'https://llm.yunhaoli.top/v1',
    defaultModel: 'free',
    requiresKey: false,
  },
};

export const PROVIDER_ORDER: ProviderId[] = [
  'groq',
  'openai',
  'deepseek',
  'ollama',
  'custom',
];

export function resolveProviderPreset(providerId: ProviderId): ProviderPreset {
  return PROVIDER_PRESETS[providerId] ?? PROVIDER_PRESETS.custom;
}
