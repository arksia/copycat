export const DEFAULT_COMPLETION_RETRY_MIN_DELTA = 3
export const DEFAULT_COMPLETION_SKIP_RETRY_MIN_DELTA = 2
export const DEFAULT_COMPLETION_SKIP_COOLDOWN_MS = 1500

export interface CompletionTriggerMemory {
  lastRequestedPrefix: string
  lastSkipPrefix: string
  lastSkipAt: number
}

export interface CompletionTriggerDecision {
  allowed: boolean
  reason?: 'delta' | 'skip_cache' | 'skip_cooldown'
}

export function createCompletionTriggerMemory(): CompletionTriggerMemory {
  return {
    lastRequestedPrefix: '',
    lastSkipPrefix: '',
    lastSkipAt: 0,
  }
}

export function evaluateCompletionTrigger(args: {
  prefix: string
  now: number
  memory: CompletionTriggerMemory
  retryMinDelta?: number
  skipRetryMinDelta?: number
  skipCooldownMs?: number
}): CompletionTriggerDecision {
  const retryMinDelta = args.retryMinDelta ?? DEFAULT_COMPLETION_RETRY_MIN_DELTA
  const skipRetryMinDelta = args.skipRetryMinDelta ?? DEFAULT_COMPLETION_SKIP_RETRY_MIN_DELTA
  const skipCooldownMs = args.skipCooldownMs ?? DEFAULT_COMPLETION_SKIP_COOLDOWN_MS
  const normalizedPrefix = normalizeCompletionPrefix(args.prefix)
  const requestedPrefix = normalizeCompletionPrefix(args.memory.lastRequestedPrefix)
  const skipPrefix = normalizeCompletionPrefix(args.memory.lastSkipPrefix)

  if (skipPrefix.length > 0 && normalizedPrefix.startsWith(skipPrefix)) {
    const skipDelta = normalizedPrefix.length - skipPrefix.length
    if (skipDelta >= skipRetryMinDelta) {
      return { allowed: true }
    }

    if (args.now - args.memory.lastSkipAt >= skipCooldownMs) {
      return { allowed: true }
    }

    return {
      allowed: false,
      reason: skipDelta === 0 ? 'skip_cache' : 'skip_cooldown',
    }
  }

  if (requestedPrefix.length > 0) {
    const delta = Math.abs(normalizedPrefix.length - requestedPrefix.length)
    if (delta < retryMinDelta) {
      return {
        allowed: false,
        reason: 'delta',
      }
    }
  }

  return { allowed: true }
}

export function normalizeCompletionPrefix(prefix: string): string {
  return prefix.replace(/\s+/g, ' ').trimStart()
}
