import { joinOpenAICompatibleUrl } from './openai-compatible'

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
