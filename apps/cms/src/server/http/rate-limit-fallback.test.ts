import { describe, expect, it, vi } from 'vitest'

import { createFallbackRateLimitStore } from './rate-limit-fallback.ts'
import { createMemoryRateLimitStore } from './memory-rate-limit-store.ts'
import type { RateLimitStore } from './rate-limit.ts'

function flakyStore(counts: { fail: boolean }): RateLimitStore & {
  calls: number
} {
  const store = {
    calls: 0,
    async increment() {
      store.calls += 1
      if (counts.fail) throw new Error('connect ECONNREFUSED redis://secret')
      return 1
    },
  }
  return store
}

describe('createMemoryRateLimitStore', () => {
  it('counts within a window and starts a new one after the TTL', async () => {
    let at = 0
    const store = createMemoryRateLimitStore(() => at)
    expect(await store.increment('k', 10)).toBe(1)
    expect(await store.increment('k', 10)).toBe(2)
    at = 9_999
    expect(await store.increment('k', 10)).toBe(3)
    at = 10_000
    expect(await store.increment('k', 10)).toBe(1)
  })

  it('keeps keys apart', async () => {
    const store = createMemoryRateLimitStore(() => 0)
    await store.increment('a', 60)
    expect(await store.increment('b', 60)).toBe(1)
  })
})

describe('createFallbackRateLimitStore', () => {
  it('uses the primary store while it is healthy', async () => {
    const primary = flakyStore({ fail: false })
    const fallback = { increment: vi.fn(async () => 99) }
    const store = createFallbackRateLimitStore({ primary, fallback })
    expect(await store.increment('k', 60)).toBe(1)
    expect(fallback.increment).not.toHaveBeenCalled()
  })

  it('keeps enforcing budgets from memory when the primary errors', async () => {
    const primary = flakyStore({ fail: true })
    const store = createFallbackRateLimitStore({
      primary,
      fallback: createMemoryRateLimitStore(() => 0),
    })
    expect(await store.increment('k', 60)).toBe(1)
    expect(await store.increment('k', 60)).toBe(2)
    expect(await store.increment('k', 60)).toBe(3)
  })

  it('logs the transition once, without the error, and again on recovery', async () => {
    const fail = { fail: true }
    const primary = flakyStore(fail)
    const onDegraded = vi.fn()
    const onRecovered = vi.fn()
    let at = 0
    const store = createFallbackRateLimitStore({
      primary,
      fallback: createMemoryRateLimitStore(() => at),
      retryAfterMs: 1_000,
      now: () => at,
      onDegraded,
      onRecovered,
    })

    await store.increment('k', 60)
    await store.increment('k', 60)
    expect(onDegraded).toHaveBeenCalledTimes(1)
    expect(onDegraded.mock.calls[0]).toEqual([])

    fail.fail = false
    at = 1_000
    await store.increment('k', 60)
    expect(onRecovered).toHaveBeenCalledTimes(1)
    expect(onDegraded).toHaveBeenCalledTimes(1)
  })

  it('skips the primary during the retry window after a failure', async () => {
    const primary = flakyStore({ fail: true })
    let at = 0
    const store = createFallbackRateLimitStore({
      primary,
      fallback: createMemoryRateLimitStore(() => at),
      retryAfterMs: 5_000,
      now: () => at,
    })
    await store.increment('k', 60)
    await store.increment('k', 60)
    expect(primary.calls).toBe(1)
    at = 5_000
    await store.increment('k', 60)
    expect(primary.calls).toBe(2)
  })
})
