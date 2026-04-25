import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  hostMatches,
  isHostEnabled,
  normalizeSettingsShape,
} from '~/utils/settings';
import type { Settings } from '~/types';

const baseSettings: Settings = {
  enabled: true,
  provider: 'groq',
  baseUrl: 'https://api.groq.com/openai/v1',
  apiKey: '',
  model: 'llama-3.1-8b-instant',
  temperature: 0.2,
  maxTokens: 128,
  debounceMs: 300,
  minPrefixChars: 3,
  disableThinking: true,
  systemPrompt: 'test',
  enabledHosts: ['chatgpt.com'],
  disabledHosts: [],
};

describe('hostMatches', () => {
  it('matches exact hosts and subdomains', () => {
    expect(hostMatches('https://chatgpt.com', 'chatgpt.com')).toBe(true);
    expect(hostMatches('https://foo.chatgpt.com', 'chatgpt.com')).toBe(true);
    expect(hostMatches('https://example.com', 'chatgpt.com')).toBe(false);
  });
});

describe('isHostEnabled', () => {
  it('returns true for allowed hosts', () => {
    expect(isHostEnabled(baseSettings, 'https://chatgpt.com')).toBe(true);
  });

  it('returns false for disabled hosts even if allowed', () => {
    const settings = {
      ...baseSettings,
      disabledHosts: ['chatgpt.com'],
    };
    expect(isHostEnabled(settings, 'https://chatgpt.com')).toBe(false);
  });
});

describe('DEFAULT_SETTINGS', () => {
  it('prefills the custom openai-compatible endpoint', () => {
    expect(DEFAULT_SETTINGS.provider).toBe('custom');
    expect(DEFAULT_SETTINGS.baseUrl).toBe('https://llm.yunhaoli.top/v1');
    expect(DEFAULT_SETTINGS.model).toBe('free');
    expect(DEFAULT_SETTINGS.maxTokens).toBe(128);
    expect(DEFAULT_SETTINGS.disableThinking).toBe(true);
  });
});

describe('normalizeSettingsShape', () => {
  it('coerces legacy host lists into arrays', () => {
    const legacySettings = {
      enabledHosts: 'chatgpt.com\nclaude.ai',
      disabledHosts: 'example.com',
    } as unknown as Partial<Settings>;

    expect(
      normalizeSettingsShape(legacySettings),
    ).toMatchObject({
      enabledHosts: ['chatgpt.com', 'claude.ai'],
      disabledHosts: ['example.com'],
    });
  });

  it('falls back to defaults for invalid scalar values', () => {
    const invalidSettings = {
      provider: 'not-real',
      maxTokens: 'bad',
      disableThinking: 'yes',
    } as unknown as Partial<Settings>;

    expect(
      normalizeSettingsShape(invalidSettings),
    ).toMatchObject({
      provider: DEFAULT_SETTINGS.provider,
      maxTokens: DEFAULT_SETTINGS.maxTokens,
      disableThinking: DEFAULT_SETTINGS.disableThinking,
    });
  });
});
