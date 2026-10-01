import { describe, expect, it, vi } from 'vitest'

import type { RateLimitStore } from './rate-limit.ts'
import { enforceRequestRateLimit, getClientIp } from './rate-limit.ts'

function countingStore(): RateLimitStore & { keys: string[] } {
  const counts = new Map<string, number>()
  const keys: string[] = []
  return {
    keys,
    async increment(key) {
      keys.push(key)
      const count = (counts.get(key) ?? 0) + 1
      counts.set(key, count)
      return count
    },
  }
}

function dependencies(store: RateLimitStore, userId: string | null = 'user-1') {
  return {
    store,
    trustProxy: false,
    now: () => 120_000,
    resolveUserId: vi.fn(async () => userId),
    logError: vi.fn(),
  }
}

describe('request rate limiting', () => {
  it('limits custom mutations to 60 requests per authenticated user', async () => {
    const store = countingStore()
    const deps = dependencies(store)
    const request = new Request('https://cms.test/_server/example', {
      method: 'POST',
    })

    for (let i = 0; i < 60; i += 1) {
      expect(await enforceRequestRateLimit(request, deps)).toBeNull()
    }
    const blocked = await enforceRequestRateLimit(request, deps)

    expect(blocked?.status).toBe(429)
    expect(blocked?.headers.get('Retry-After')).toBe('60')
    expect(new Set(store.keys)).toHaveLength(1)
    expect(store.keys[0]).toContain(':mutation:')
  })

  it('uses the stricter upload limit without also consuming mutation quota', async () => {
    const store = countingStore()
    const deps = dependencies(store)
    const request = new Request('https://cms.test/api/assets/upload', {
      method: 'POST',
    })

    for (let i = 0; i < 10; i += 1) {
      expect(await enforceRequestRateLimit(request, deps)).toBeNull()
    }
    expect((await enforceRequestRateLimit(request, deps))?.status).toBe(429)
    expect(store.keys.every((key) => key.includes(':upload:'))).toBe(true)
  })

  it('limits the bearer-authenticated site API to 300 per token', async () => {
    const store = countingStore()
    const deps = dependencies(store)
    const request = new Request('https://cms.test/api/sites/snapshot/current', {
      headers: { Authorization: 'Bearer site-secret' },
    })

    for (let i = 0; i < 300; i += 1) {
      expect(await enforceRequestRateLimit(request, deps)).toBeNull()
    }
    expect((await enforceRequestRateLimit(request, deps))?.status).toBe(429)
    expect(deps.resolveUserId).not.toHaveBeenCalled()
    expect(store.keys[0]).not.toContain('site-secret')
  })

  it('uses a trusted forwarded IP only when proxy trust is enabled', () => {
    const request = new Request('https://cms.test/setup', {
      headers: { 'X-Forwarded-For': '203.0.113.9, 10.0.0.2' },
    })
    expect(getClientIp(request, false)).toBe('unknown')
    expect(getClientIp(request, true)).toBe('203.0.113.9')
  })

  it('leaves Better Auth rate limiting untouched', async () => {
    const store = countingStore()
    const deps = dependencies(store)
    const request = new Request('https://cms.test/api/auth/sign-in/email', {
      method: 'POST',
    })

    expect(await enforceRequestRateLimit(request, deps)).toBeNull()
    expect(store.keys).toHaveLength(0)
    expect(deps.resolveUserId).not.toHaveBeenCalled()
  })

  it('does not allow a trailing slash to bypass site API limits', async () => {
    const store = countingStore()
    const deps = dependencies(store)
    const request = new Request(
      'https://cms.test/api/sites/snapshot/current/',
      { headers: { Authorization: 'Bearer site-secret' } },
    )

    await enforceRequestRateLimit(request, deps)

    expect(store.keys[0]).toContain(':site-api:')
    expect(deps.resolveUserId).not.toHaveBeenCalled()
  })

  it('fails open and logs when Redis is unavailable', async () => {
    const error = new Error('redis unavailable')
    const deps = dependencies({
      increment: vi.fn(async () => Promise.reject(error)),
    })
    const request = new Request('https://cms.test/_server/example', {
      method: 'POST',
    })

    expect(await enforceRequestRateLimit(request, deps)).toBeNull()
    expect(deps.logError).toHaveBeenCalledWith(
      'Rate limiting unavailable; request allowed',
      error,
    )
  })

  it('never limits GET /api/health or /api/health/ready', async () => {
    const store = countingStore()
    const deps = dependencies(store)
    for (const path of ['/api/health', '/api/health/ready', '/api/health/']) {
      for (let i = 0; i < 500; i += 1) {
        expect(
          await enforceRequestRateLimit(
            new Request(`https://cms.test${path}`),
            deps,
          ),
        ).toBeNull()
      }
    }
    expect(store.keys).toHaveLength(0)
  })

  it('keeps /api/metrics rate limited per client to stop token guessing', async () => {
    const store = countingStore()
    const deps = dependencies(store)
    const request = new Request('https://cms.test/api/metrics', {
      headers: { authorization: 'Bearer guess' },
    })
    for (let i = 0; i < 60; i += 1) {
      expect(await enforceRequestRateLimit(request, deps)).toBeNull()
    }
    const blocked = await enforceRequestRateLimit(request, deps)
    expect(blocked?.status).toBe(429)
    expect(store.keys.every((key) => key.includes(':metrics:'))).toBe(true)
    expect(deps.resolveUserId).not.toHaveBeenCalled()
  })
})
