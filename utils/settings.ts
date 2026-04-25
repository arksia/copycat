import type { Settings } from '~/types';
import { PROVIDER_PRESETS } from './providers';

const STORAGE_KEY = 'copycat:settings:v1';

export const DEFAULT_SYSTEM_PROMPT = `You are an inline autocomplete engine for an AI chat input box.
Given the user's partially written message (prefix), continue it with ONE short, natural continuation
in the SAME language as the prefix. Rules:
- Output ONLY the continuation text, with NO quotes, NO markdown, NO explanations.
- Do NOT analyze, translate, describe, or discuss the prefix.
- Continue directly from the last character of the prefix.
- Do NOT repeat the prefix.
- Keep it short: a few words up to one sentence.
- Return an empty string only if the prefix already looks complete.
- Preserve tone and register. Never add trailing whitespace.`;

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  provider: 'custom',
  baseUrl: PROVIDER_PRESETS.custom.baseUrl,
  apiKey: '',
  model: PROVIDER_PRESETS.custom.defaultModel,
  temperature: 0.2,
  maxTokens: 128,
  debounceMs: 300,
  minPrefixChars: 3,
  disableThinking: true,
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
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
};

export async function loadSettings(): Promise<Settings> {
  const raw = await chrome.storage.local.get(STORAGE_KEY);
  const stored = (raw[STORAGE_KEY] ?? {}) as Partial<Settings>;
  return normalizeSettingsShape(stored);
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const current = await loadSettings();
  const next = normalizeSettingsShape({ ...current, ...patch });
  await chrome.storage.local.set({ [STORAGE_KEY]: next });
  return next;
}

export function onSettingsChanged(handler: (next: Settings) => void): () => void {
  const listener = (
    changes: Record<string, chrome.storage.StorageChange>,
    area: chrome.storage.AreaName,
  ) => {
    if (area !== 'local' || !(STORAGE_KEY in changes)) return;
    const next = normalizeSettingsShape((changes[STORAGE_KEY].newValue ?? {}) as Partial<Settings>);
    handler(next);
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}

export function normalizeSettingsShape(stored: Partial<Settings>): Settings {
  const next: Settings = {
    ...DEFAULT_SETTINGS,
    ...stored,
    provider: isProviderId(stored.provider) ? stored.provider : DEFAULT_SETTINGS.provider,
    enabledHosts: normalizeHostList(stored.enabledHosts, DEFAULT_SETTINGS.enabledHosts),
    disabledHosts: normalizeHostList(stored.disabledHosts, DEFAULT_SETTINGS.disabledHosts),
    maxTokens: normalizeNumber(stored.maxTokens, DEFAULT_SETTINGS.maxTokens),
    debounceMs: normalizeNumber(stored.debounceMs, DEFAULT_SETTINGS.debounceMs),
    minPrefixChars: normalizeNumber(stored.minPrefixChars, DEFAULT_SETTINGS.minPrefixChars),
    temperature: normalizeNumber(stored.temperature, DEFAULT_SETTINGS.temperature),
    disableThinking:
      typeof stored.disableThinking === 'boolean'
        ? stored.disableThinking
        : DEFAULT_SETTINGS.disableThinking,
  };

  return next;
}

function isProviderId(value: unknown): value is Settings['provider'] {
  return typeof value === 'string' && value in PROVIDER_PRESETS;
}

function normalizeHostList(value: unknown, fallback: string[]): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return fallback.slice();
}

function normalizeNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function hostMatches(url: string, host: string): boolean {
  try {
    const u = new URL(url);
    return u.hostname === host || u.hostname.endsWith('.' + host);
  } catch {
    return false;
  }
}

export function isHostEnabled(settings: Settings, url: string): boolean {
  if (!settings.enabled) return false;
  if (settings.disabledHosts.some((h) => hostMatches(url, h))) return false;
  if (settings.enabledHosts.length === 0) return true;
  return settings.enabledHosts.some((h) => hostMatches(url, h));
}
