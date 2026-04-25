import type { CompletionDebugInfo, Settings } from '~/types';
import {
  buildOpenAICompatibleHeaders,
  joinOpenAICompatibleUrl,
} from './openai-compatible';

export interface CompleteArgs {
  prefix: string;
  suffix?: string;
  context?: string;
  settings: Settings;
  signal?: AbortSignal;
}

export interface CompleteResult {
  completion: string;
  debug: CompletionDebugInfo;
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ChatChoice {
  message?: {
    content?: string;
    reasoning_content?: string;
  };
  delta?: { content?: string };
  finish_reason?: string | null;
}

interface ChatCompletionBody {
  model: string;
  messages: ChatMessage[];
  temperature: number;
  max_tokens: number;
  stream: false;
  reasoning?: {
    enabled: boolean;
  };
  thinking?: {
    type: string;
  };
}

export async function completeOnce({
  prefix,
  suffix,
  context,
  settings,
  signal,
}: CompleteArgs): Promise<string> {
  const result = await completeOnceDetailed({
    prefix,
    suffix,
    context,
    settings,
    signal,
  });
  return result.completion;
}

export async function completeOnceDetailed({
  prefix,
  suffix,
  context,
  settings,
  signal,
}: CompleteArgs): Promise<CompleteResult> {
  const url = joinOpenAICompatibleUrl(settings.baseUrl, '/chat/completions');
  const userPrompt = buildUserPrompt({ prefix, suffix, context });
  let firstAttempt;
  try {
    firstAttempt = await requestCompletionAttempt({
      url,
      systemPrompt: settings.systemPrompt,
      userPrompt,
      settings,
      signal,
      prefix,
    });
  } catch (error) {
    if (!shouldRetryAfterReasoningBudgetError(error)) {
      throw error;
    }

    const strictSystemPrompt = buildStrictSystemPrompt(settings.systemPrompt);
    const recoveredAttempt = await requestCompletionAttempt({
      url,
      systemPrompt: strictSystemPrompt,
      userPrompt,
      settings: {
        ...settings,
        temperature: Math.min(settings.temperature, 0.1),
        maxTokens: buildReasoningRecoveryMaxTokens(settings.maxTokens),
      },
      signal,
      prefix,
    });

    return toCompleteResult(recoveredAttempt, strictSystemPrompt, userPrompt);
  }

  if (!shouldRetryWithStrictPrompt(firstAttempt.rawCompletion, firstAttempt.completion)) {
    return toCompleteResult(firstAttempt, settings.systemPrompt, userPrompt);
  }

  const strictSystemPrompt = buildStrictSystemPrompt(settings.systemPrompt);
  const secondAttempt = await requestCompletionAttempt({
    url,
    systemPrompt: strictSystemPrompt,
    userPrompt,
    settings: {
      ...settings,
      temperature: Math.min(settings.temperature, 0.1),
      maxTokens: Math.max(settings.maxTokens, 128),
    },
    signal,
    prefix,
  });

  return toCompleteResult(secondAttempt, strictSystemPrompt, userPrompt);
}

function buildUserPrompt(args: {
  prefix: string;
  suffix?: string;
  context?: string;
}): string {
  const userParts: string[] = [];
  if (args.context && args.context.trim()) {
    userParts.push(`[Knowledge]\n${args.context.trim()}`);
  }
  userParts.push(
    `[Prefix]\n${args.prefix}\n\n[Task]\nContinue the prefix with a short, natural continuation. ` +
      `Output ONLY the continuation text, without repeating the prefix.`,
  );
  if (args.suffix && args.suffix.trim()) {
    userParts.push(`[Suffix after cursor]\n${args.suffix}`);
  }
  return userParts.join('\n\n');
}

async function safeReadText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

async function requestCompletionAttempt(args: {
  url: string;
  systemPrompt: string;
  userPrompt: string;
  settings: Settings;
  signal?: AbortSignal;
  prefix: string;
}) {
  const headers = buildOpenAICompatibleHeaders(args.settings.apiKey);

  const primaryBody = buildChatCompletionBody({
    model: args.settings.model,
    systemPrompt: args.systemPrompt,
    userPrompt: args.userPrompt,
    temperature: args.settings.temperature,
    maxTokens: args.settings.maxTokens,
    disableThinking: args.settings.disableThinking,
  });
  let finalBody = primaryBody;
  let thinkingControlsFallback = false;

  let res = await fetch(args.url, {
    method: 'POST',
    headers,
    body: JSON.stringify(primaryBody),
    signal: args.signal,
  });

  if (!res.ok) {
    const text = await safeReadText(res);
    if (args.settings.disableThinking && shouldRetryWithoutThinkingControls(res.status, text)) {
      const fallbackBody = buildChatCompletionBody({
        model: args.settings.model,
        systemPrompt: args.systemPrompt,
        userPrompt: args.userPrompt,
        temperature: args.settings.temperature,
        maxTokens: args.settings.maxTokens,
        disableThinking: false,
      });
      finalBody = fallbackBody;
      thinkingControlsFallback = true;
      res = await fetch(args.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(fallbackBody),
        signal: args.signal,
      });
      if (!res.ok) {
        const fallbackText = await safeReadText(res);
        throw new Error(`LLM HTTP ${res.status}: ${truncate(fallbackText, 200)}`);
      }
    } else {
      throw new Error(`LLM HTTP ${res.status}: ${truncate(text, 200)}`);
    }
  }

  const json = (await res.json()) as { choices?: ChatChoice[] };
  const choice = json.choices?.[0];
  const rawCompletion = extractRawCompletion(choice);
  const completion = sanitizeCompletion(rawCompletion, args.prefix);

  return {
    rawCompletion,
    completion,
    rawChoice: safeStringify(choice ?? null),
    finalBody,
    disableThinkingRequested: args.settings.disableThinking,
    thinkingControlsFallback,
  };
}

function buildChatCompletionBody(args: {
  model: string;
  systemPrompt: string;
  userPrompt: string;
  temperature: number;
  maxTokens: number;
  disableThinking: boolean;
}): ChatCompletionBody {
  const messages: ChatMessage[] = [
    { role: 'system', content: args.systemPrompt },
    { role: 'user', content: args.userPrompt },
  ];
  const body: ChatCompletionBody = {
    model: args.model,
    messages,
    temperature: args.temperature,
    max_tokens: args.maxTokens,
    stream: false,
  };
  if (args.disableThinking) {
    body.reasoning = { enabled: false };
    body.thinking = { type: 'disabled' };
  }
  return body;
}

function shouldRetryWithoutThinkingControls(status: number, responseText: string): boolean {
  if (status !== 400) return false;
  const normalized = responseText.toLowerCase();
  return [
    'unknown field',
    'unknown parameter',
    'unsupported field',
    'unsupported parameter',
    'invalid field',
    'invalid parameter',
    'reasoning',
    'thinking',
  ].some((pattern) => normalized.includes(pattern));
}

function toCompleteResult(
  attempt: {
    rawCompletion: string;
    completion: string;
    rawChoice: string;
    finalBody: ChatCompletionBody;
    disableThinkingRequested: boolean;
    thinkingControlsFallback: boolean;
  },
  systemPrompt: string,
  userPrompt: string,
): CompleteResult {
  return {
    completion: attempt.completion,
    debug: {
      rawCompletion: attempt.rawCompletion,
      sanitizedCompletion: attempt.completion,
      rawChoice: attempt.rawChoice,
      cacheHit: false,
      disableThinkingRequested: attempt.disableThinkingRequested,
      thinkingControlsFallback: attempt.thinkingControlsFallback,
      requestBody: {
        systemPrompt,
        userPrompt,
        reasoning: attempt.finalBody.reasoning,
        thinking: attempt.finalBody.thinking,
      },
    },
  };
}

export function extractRawCompletion(choice?: ChatChoice): string {
  const content = choice?.message?.content ?? choice?.delta?.content ?? '';
  if (content) return content;

  const reasoning = choice?.message?.reasoning_content?.trim() ?? '';
  if (reasoning) {
    if (choice?.finish_reason === 'length') {
      throw new Error(
        'The selected reasoning model used its output budget on reasoning content before producing a completion. Choose a non-reasoning chat model or increase max tokens.',
      );
    }
    throw new Error(
      'The selected reasoning model returned reasoning content without a completion. Choose a non-reasoning chat model for inline autocomplete.',
    );
  }

  return '';
}

function buildStrictSystemPrompt(base: string): string {
  return [
    base,
    'You are not a chatbot.',
    'Never explain the task, the user, the prefix, or your reasoning.',
    'Output only the next words that should appear immediately after the prefix.',
    'If you mention "the user", "the prefix", a translation, or an explanation, the answer is invalid.',
  ].join('\n');
}

function shouldRetryAfterReasoningBudgetError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.message.includes(
    'used its output budget on reasoning content before producing a completion',
  );
}

function buildReasoningRecoveryMaxTokens(maxTokens: number): number {
  return Math.max(maxTokens * 2, 256);
}

/**
 * Strip common wrapping and ensure we don't repeat the prefix the user already typed.
 * We also cap overly long completions at the first sentence boundary.
 */
export function sanitizeCompletion(raw: string, prefix: string): string {
  if (!raw) return '';
  let out = raw.replace(/\r/g, '');

  if (looksLikeMetaAnalysis(out)) {
    return '';
  }

  // Drop surrounding quotes / code fences the model sometimes adds.
  out = out.replace(/^```[\s\S]*?\n/, '').replace(/\n```$/, '');
  out = out.replace(/^\s*["'“”‘’「」『』]+/, '').replace(/["'“”‘’「」『』]+\s*$/, '');

  // If the model echoed the prefix, strip it.
  const trimmedPrefix = prefix.trimEnd();
  if (trimmedPrefix && out.startsWith(trimmedPrefix)) {
    out = out.slice(trimmedPrefix.length);
  }

  // Collapse leading whitespace only if prefix ends with whitespace already.
  if (/\s$/.test(prefix)) {
    out = out.replace(/^\s+/, '');
  }

  // Hard cap: first 2 lines, trim trailing whitespace.
  const lines = out.split('\n');
  if (lines.length > 2) out = lines.slice(0, 2).join('\n');
  out = out.replace(/[\s\u3000]+$/u, '');

  return out;
}

function looksLikeMetaAnalysis(raw: string): boolean {
  const normalized = raw.trim().toLowerCase();
  if (!normalized) return false;

  return [
    "the user's prefix",
    'the user wants me to',
    'about developing a',
    'the prefix seems',
    'the user likely wants',
    'looking at the context',
    'the sentence is incomplete',
    'translation:',
    'continue with',
  ].some((pattern) => normalized.includes(pattern));
}

function shouldRetryWithStrictPrompt(raw: string, completion: string): boolean {
  return !completion && looksLikeMetaAnalysis(raw);
}
