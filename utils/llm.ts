import type { Settings } from '~/types';

export interface CompleteArgs {
  prefix: string;
  suffix?: string;
  context?: string;
  settings: Settings;
  signal?: AbortSignal;
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export async function completeOnce({
  prefix,
  suffix,
  context,
  settings,
  signal,
}: CompleteArgs): Promise<string> {
  const url = joinUrl(settings.baseUrl, '/chat/completions');

  const userParts: string[] = [];
  if (context && context.trim()) {
    userParts.push(`[Knowledge]\n${context.trim()}`);
  }
  userParts.push(
    `[Prefix]\n${prefix}\n\n[Task]\nContinue the prefix with a short, natural continuation. ` +
      `Output ONLY the continuation text, without repeating the prefix.`,
  );
  if (suffix && suffix.trim()) {
    userParts.push(`[Suffix after cursor]\n${suffix}`);
  }

  const messages: ChatMessage[] = [
    { role: 'system', content: settings.systemPrompt },
    { role: 'user', content: userParts.join('\n\n') },
  ];

  const body = {
    model: settings.model,
    messages,
    temperature: settings.temperature,
    max_tokens: settings.maxTokens,
    stream: false,
  };

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (settings.apiKey) {
    headers['Authorization'] = `Bearer ${settings.apiKey}`;
  }

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const text = await safeReadText(res);
    throw new Error(`LLM HTTP ${res.status}: ${truncate(text, 200)}`);
  }

  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string }; delta?: { content?: string } }>;
  };

  const raw = json.choices?.[0]?.message?.content ?? '';
  return sanitizeCompletion(raw, prefix);
}

function joinUrl(base: string, path: string): string {
  if (!base) return path;
  const b = base.replace(/\/+$/, '');
  const p = path.replace(/^\/+/, '');
  return `${b}/${p}`;
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

/**
 * Strip common wrapping and ensure we don't repeat the prefix the user already typed.
 * We also cap overly long completions at the first sentence boundary.
 */
export function sanitizeCompletion(raw: string, prefix: string): string {
  if (!raw) return '';
  let out = raw.replace(/\r/g, '');

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
