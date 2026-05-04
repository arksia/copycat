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

/**
 * A single discovered model entry from a host model-list response.
 */
export interface DiscoveredModel {
  id: string
  ownedBy?: string
}

/**
 * Builds the model discovery endpoint for an OpenAI-compatible host.
 *
 * Before:
 * - `"https://example.com/v1/"`
 *
 * After:
 * - `"https://example.com/v1/models"`
 */
export function buildModelsUrl(baseUrl: string): string {
  return joinOpenAICompatibleUrl(baseUrl, '/models')
}

/**
 * Parses a model-list payload into the normalized UI model shape.
 *
 * Before:
 * - `{ data: [{ id: "chat-model", owned_by: "host" }, null, {}] }`
 *
 * After:
 * - `[{ id: "chat-model", ownedBy: "host" }]`
 */
export function parseModelListResponse(payload: unknown): DiscoveredModel[] {
  const items = Array.isArray((payload as { data?: unknown[] } | null)?.data)
    ? (payload as { data: unknown[] }).data
    : []

  const models: DiscoveredModel[] = []
  for (const item of items) {
    if (typeof item !== 'object' || item === null)
      continue
    const id = typeof (item as { id?: unknown }).id === 'string' ? (item as { id: string }).id : ''
    if (!id)
      continue
    const ownedBy
      = typeof (item as { owned_by?: unknown }).owned_by === 'string'
        ? (item as { owned_by: string }).owned_by
        : undefined
    models.push({ id, ownedBy })
  }
  return models
}
