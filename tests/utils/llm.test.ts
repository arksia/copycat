import { afterEach, describe, expect, it, vi } from 'vitest';
import { completeOnceDetailed, extractRawCompletion, sanitizeCompletion } from '~/utils/llm';
import { DEFAULT_SYSTEM_PROMPT } from '~/utils/settings';
import type { Settings } from '~/types';

const baseSettings: Settings = {
  enabled: true,
  provider: 'custom',
  baseUrl: 'https://llm.yunhaoli.top/v1',
  apiKey: '',
  model: 'free',
  temperature: 0.2,
  maxTokens: 128,
  debounceMs: 300,
  minPrefixChars: 3,
  disableThinking: true,
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  enabledHosts: [],
  disabledHosts: [],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('sanitizeCompletion', () => {
  it('strips echoed prefix and trailing whitespace', () => {
    expect(sanitizeCompletion('hello world  ', 'hello')).toBe(' world');
  });

  it('removes wrapping quotes from model output', () => {
    expect(sanitizeCompletion('"next step"', 'prefix')).toBe('next step');
  });

  it('drops meta-analysis instead of treating it as a completion', () => {
    const raw =
      "The user's prefix is in Chinese. The prefix seems incomplete. The user likely wants to continue with";

    expect(sanitizeCompletion(raw, '我想开发一个博客系统，首先需要使用虚拟')).toBe('');
  });
});

describe('DEFAULT_SYSTEM_PROMPT', () => {
  it('does not allow empty completion just because the model is unsure', () => {
    expect(DEFAULT_SYSTEM_PROMPT).not.toContain('or you are unsure');
  });
});

describe('extractRawCompletion', () => {
  it('returns assistant content when present', () => {
    expect(
      extractRawCompletion({
        message: { content: 'virtual machine' },
        finish_reason: 'stop',
      }),
    ).toBe('virtual machine');
  });

  it('throws a descriptive error when a reasoning model uses up the output budget', () => {
    expect(() =>
      extractRawCompletion({
        message: {
          content: '',
          reasoning_content: 'The prefix is incomplete and likely refers to...',
        },
        finish_reason: 'length',
      }),
    ).toThrow(/reasoning model/i);
  });
});

describe('completeOnceDetailed', () => {
  it('adds thinking-disable parameters when the setting is enabled', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: '主机环境',
            },
            finish_reason: 'stop',
          },
        ],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await completeOnceDetailed({
      prefix: '我想开发一个博客系统，首先需要使用虚拟',
      settings: baseSettings,
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body.reasoning).toEqual({ enabled: false });
    expect(body.thinking).toEqual({ type: 'disabled' });
    expect(result.debug.disableThinkingRequested).toBe(true);
    expect(result.debug.requestBody.reasoning).toEqual({ enabled: false });
    expect(result.debug.requestBody.thinking).toEqual({ type: 'disabled' });
    expect(result.debug.thinkingControlsFallback).toBe(false);
  });

  it('falls back to a plain request when the host rejects thinking-disable parameters', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => 'unknown field: thinking',
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: '主机环境',
              },
              finish_reason: 'stop',
            },
          ],
        }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const result = await completeOnceDetailed({
      prefix: '我想开发一个博客系统，首先需要使用虚拟',
      settings: baseSettings,
    });

    const firstBody = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body));
    const secondBody = JSON.parse(String((fetchMock.mock.calls[1] as [string, RequestInit])[1].body));

    expect(result.completion).toBe('主机环境');
    expect(firstBody.thinking).toEqual({ type: 'disabled' });
    expect(secondBody.thinking).toBeUndefined();
    expect(secondBody.reasoning).toBeUndefined();
    expect(result.debug.thinkingControlsFallback).toBe(true);
    expect(result.debug.requestBody.reasoning).toBeUndefined();
    expect(result.debug.requestBody.thinking).toBeUndefined();
  });

  it('retries once with a stricter prompt when the first response is meta-analysis', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content:
                  "The user wants me to continue a Chinese prefix about developing a blog system.",
              },
              finish_reason: 'length',
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: '主机环境',
              },
              finish_reason: 'stop',
            },
          ],
        }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const result = await completeOnceDetailed({
      prefix: '我想开发一个博客系统，首先需要使用虚拟',
      settings: {
        ...baseSettings,
        maxTokens: 48,
      },
    });

    expect(result.completion).toBe('主机环境');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondBody = JSON.parse(String((fetchMock.mock.calls[1] as [string, RequestInit])[1].body));
    expect(secondBody.max_tokens).toBe(128);
  });

  it('retries with a larger token budget when the model spends the first response on reasoning', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: '',
                reasoning_content: 'The prefix is incomplete and likely refers to setting up a virtual machine.',
              },
              finish_reason: 'length',
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: '主机环境',
              },
              finish_reason: 'stop',
            },
          ],
        }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const result = await completeOnceDetailed({
      prefix: '我想开发一个博客系统，首先需要使用虚拟',
      settings: baseSettings,
    });

    const firstBody = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body));
    const secondBody = JSON.parse(String((fetchMock.mock.calls[1] as [string, RequestInit])[1].body));

    expect(result.completion).toBe('主机环境');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(firstBody.max_tokens).toBe(128);
    expect(secondBody.max_tokens).toBe(256);
  });
});
