import type { Settings } from '~/types';
import { PROVIDER_PRESETS } from './providers';

const STORAGE_KEY = 'copycat:settings:v1';

export const DEFAULT_SYSTEM_PROMPT = `You are an inline autocomplete engine for an AI chat input box.
Given the user's partially written message (prefix), continue it with ONE short, natural continuation
in the SAME language as the prefix. Rules:
- Output ONLY the continuation text, with NO quotes, NO markdown, NO explanations.
- Do NOT repeat the prefix.
- Keep it short: a few words up to one sentence.
- If the prefix already looks complete or you are unsure, return an empty string.
- Preserve tone and register. Never add trailing whitespace.`;

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
  return { ...DEFAULT_SETTINGS, ...stored };
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const current = await loadSettings();
  const next: Settings = { ...current, ...patch };
  await chrome.storage.local.set({ [STORAGE_KEY]: next });
  return next;
}

export function onSettingsChanged(handler: (next: Settings) => void): () => void {
  const listener = (
    changes: Record<string, chrome.storage.StorageChange>,
    area: chrome.storage.AreaName,
  ) => {
    if (area !== 'local' || !(STORAGE_KEY in changes)) return;
    const next = { ...DEFAULT_SETTINGS, ...(changes[STORAGE_KEY].newValue ?? {}) } as Settings;
    handler(next);
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
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
