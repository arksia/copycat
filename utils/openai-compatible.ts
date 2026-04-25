export function joinOpenAICompatibleUrl(baseUrl: string, path: string): string {
  if (!baseUrl) return path;
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, '');
  const normalizedPath = path.replace(/^\/+/, '');
  return `${normalizedBaseUrl}/${normalizedPath}`;
}

export function buildOpenAICompatibleHeaders(apiKey: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  return headers;
}

export function extractAssistantMessageContent(payload: unknown): string {
  const choices = Array.isArray((payload as { choices?: unknown[] } | null)?.choices)
    ? (payload as { choices: unknown[] }).choices
    : [];
  const firstChoice = choices[0];
  if (!firstChoice || typeof firstChoice !== 'object') return '';

  const message =
    typeof (firstChoice as { message?: unknown }).message === 'object' &&
    (firstChoice as { message?: unknown }).message !== null
      ? ((firstChoice as { message: { content?: unknown } }).message ?? {})
      : {};

  return typeof message.content === 'string' ? message.content : '';
}
