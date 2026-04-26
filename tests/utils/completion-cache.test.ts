import { describe, expect, it } from 'vitest'
import {
  buildCompletionCacheKey,
  CompletionMemoryCache,
} from '~/utils/completion-cache'

describe('buildCompletionCacheKey', () => {
  it('changes when request context changes', () => {
    const a = buildCompletionCacheKey({
      provider: 'groq',
      model: 'llama',
      prefix: 'hello',
      suffix: '',
      context: '',
    })
    const b = buildCompletionCacheKey({
      provider: 'groq',
      model: 'llama',
      prefix: 'hello',
      suffix: ' world',
      context: '',
    })

    expect(a).not.toBe(b)
  })
})

describe('completionMemoryCache', () => {
  it('returns stored values before ttl expiry', () => {
    const cache = new CompletionMemoryCache(10, 1000)
    cache.set('a', 'hello', 100)

    expect(cache.get('a', 500)).toBe('hello')
  })

  it('expires stale entries', () => {
    const cache = new CompletionMemoryCache(10, 1000)
    cache.set('a', 'hello', 100)

    expect(cache.get('a', 1200)).toBeNull()
  })

  it('evicts the oldest entry when max size is exceeded', () => {
    const cache = new CompletionMemoryCache(2, 1000)
    cache.set('a', 'first', 0)
    cache.set('b', 'second', 1)
    cache.set('c', 'third', 2)

    expect(cache.get('a', 10)).toBeNull()
    expect(cache.get('b', 10)).toBe('second')
    expect(cache.get('c', 10)).toBe('third')
  })
})
