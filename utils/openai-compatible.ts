/**
 * Joins an OpenAI-compatible base URL with a relative API path.
 *
 * Before:
 * - `baseUrl = "https://example.com/v1/"`, `path = "/models"`
 *
 * After:
 * - `"https://example.com/v1/models"`
 */
export function joinOpenAICompatibleUrl(baseUrl: string, path: string): string {
  if (!baseUrl)
    return path
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, '')
  const normalizedPath = path.replace(/^\/+/, '')
  return `${normalizedBaseUrl}/${normalizedPath}`
}

/**
 * Builds the standard headers for an OpenAI-compatible JSON request.
 *
 * Use when:
 * - sending chat completions or model discovery requests
 * - an API key should be attached only when present
 *
 * Expects:
 * - `apiKey` to be an empty string when authentication is not configured
 *
 * Returns:
 * - a plain request-header object with JSON content type and optional bearer auth
 */
export function buildOpenAICompatibleHeaders(apiKey: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`
  }
  return headers
}

/**
 * Extracts the first assistant message string from an OpenAI-compatible payload.
 *
 * Use when:
 * - validating a host connection with a minimal chat-completions response
 * - callers need a plain string without pulling in full response typing
 *
 * Expects:
 * - `payload` to be an unknown parsed JSON object from a chat-completions request
 *
 * Returns:
 * - the first assistant content string, or an empty string when unavailable
 */
export function extractAssistantMessageContent(payload: unknown): string {
  const choices = Array.isArray((payload as { choices?: unknown[] } | null)?.choices)
    ? (payload as { choices: unknown[] }).choices
    : []
  const firstChoice = choices[0]
  if (typeof firstChoice !== 'object' || firstChoice === null)
    return ''

  const message
    = typeof (firstChoice as { message?: unknown }).message === 'object'
      && (firstChoice as { message?: unknown }).message !== null
      ? ((firstChoice as { message: { content?: unknown } }).message ?? {})
      : {}

  return typeof message.content === 'string' ? message.content : ''
}
