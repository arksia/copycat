import { joinOpenAICompatibleUrl } from './openai-compatible';

export interface DiscoveredModel {
  id: string;
  ownedBy?: string;
}

export function buildModelsUrl(baseUrl: string): string {
  return joinOpenAICompatibleUrl(baseUrl, '/models');
}

export function parseModelListResponse(payload: unknown): DiscoveredModel[] {
  const items = Array.isArray((payload as { data?: unknown[] } | null)?.data)
    ? (payload as { data: unknown[] }).data
    : [];

  const models: DiscoveredModel[] = [];
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const id = typeof (item as { id?: unknown }).id === 'string' ? (item as { id: string }).id : '';
    if (!id) continue;
    const ownedBy =
      typeof (item as { owned_by?: unknown }).owned_by === 'string'
        ? (item as { owned_by: string }).owned_by
        : undefined;
    models.push({ id, ownedBy });
  }
  return models;
}
