import type { ProviderId } from '~/types';

export interface CompletionCacheKeyParts {
  provider: ProviderId;
  model: string;
  prefix: string;
  suffix?: string;
  context?: string;
}

interface CacheEntry {
  value: string;
  expiresAt: number;
}

export function buildCompletionCacheKey(parts: CompletionCacheKeyParts): string {
  return [
    parts.provider,
    parts.model,
    parts.prefix,
    parts.suffix ?? '',
    parts.context ?? '',
  ].join('\u241f');
}

export class CompletionMemoryCache {
  private readonly entries = new Map<string, CacheEntry>();

  constructor(
    private readonly maxEntries = 50,
    private readonly ttlMs = 15_000,
  ) {}

  get(key: string, now = Date.now()): string | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= now) {
      this.entries.delete(key);
      return null;
    }

    // Refresh recency for a tiny LRU-like behavior.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: string, now = Date.now()): void {
    if (!value) return;
    if (this.entries.has(key)) {
      this.entries.delete(key);
    }
    this.entries.set(key, {
      value,
      expiresAt: now + this.ttlMs,
    });
    this.evictOverflow();
  }

  private evictOverflow(): void {
    while (this.entries.size > this.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      if (!oldestKey) return;
      this.entries.delete(oldestKey);
    }
  }
}
