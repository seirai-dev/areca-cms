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

  it('limits the MCP endpoint to 120 per AI key, without the mutation budget', async () => {
    const store = countingStore()
    const deps = dependencies(store)
    const request = new Request('https://cms.test/api/mcp', {
      method: 'POST',
      headers: { Authorization: 'Bearer areca_mcp_secret-key' },
    })

    for (let i = 0; i < 120; i += 1) {
      expect(await enforceRequestRateLimit(request, deps)).toBeNull()
    }
    expect((await enforceRequestRateLimit(request, deps))?.status).toBe(429)
    expect(deps.resolveUserId).not.toHaveBeenCalled()
    expect(store.keys.every((key) => key.includes(':mcp:') || key.includes(':mcp-ip:'))).toBe(true)
    expect(store.keys.some((key) => key.includes(':mcp:'))).toBe(true)
    expect(store.keys.join('\n')).not.toContain('areca_mcp_secret-key')
  })

  it('buckets an AI key by the SHA-256 of its token, never the raw token', async () => {
    const store = countingStore()
    const deps = dependencies(store)
    const token = 'areca_mcp_raw-secret-value'
    await enforceRequestRateLimit(
      new Request('https://cms.test/api/mcp', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      }),
      deps,
    )
    const perKey = store.keys.find((key) => key.includes(':mcp:'))
    expect(perKey).toBeDefined()
    expect(perKey).not.toContain(token)
    expect(perKey).not.toContain('raw-secret-value')
    expect(perKey).toMatch(/:mcp:[0-9a-f]{64}:\d+$/)
  })

  it('throttles a flood of fake bearer tokens from one IP, though each token is new', async () => {
    const store = countingStore()
    const deps = { ...dependencies(store), trustProxy: true }
    const headers = (i: number) => ({
      Authorization: `Bearer areca_mcp_fake-${i}`,
      'X-Forwarded-For': '198.51.100.7',
    })

    // Each fake token gets its own per-key bucket, so only the per-IP rule can stop them.
    for (let i = 0; i < 600; i += 1) {
      const response = await enforceRequestRateLimit(
        new Request('https://cms.test/api/mcp', { method: 'POST', headers: headers(i) }),
        deps,
      )
      expect(response).toBeNull()
    }
    const blocked = await enforceRequestRateLimit(
      new Request('https://cms.test/api/mcp', { method: 'POST', headers: headers(600) }),
      deps,
    )
    expect(blocked?.status).toBe(429)
    expect(blocked?.headers.get('Retry-After')).toBe('60')
    expect(store.keys.filter((key) => key.includes(':mcp-ip:'))).toHaveLength(601)
  })

  it('skips the per-IP MCP budget when the client IP is unknown', async () => {
    const store = countingStore()
    const deps = dependencies(store)
    for (let i = 0; i < 700; i += 1) {
      const response = await enforceRequestRateLimit(
        new Request('https://cms.test/api/mcp', {
          method: 'POST',
          headers: { Authorization: `Bearer areca_mcp_agent-${i % 10}` },
        }),
        deps,
      )
      expect(response).toBeNull()
    }
    expect(store.keys.some((key) => key.includes(':mcp-ip:'))).toBe(false)
  })

  it('keeps a per-IP MCP budget separate for each client when proxy trust is on', async () => {
    const store = countingStore()
    const deps = { ...dependencies(store), trustProxy: true }
    for (let i = 0; i < 600; i += 1) {
      await enforceRequestRateLimit(
        new Request('https://cms.test/api/mcp', {
          method: 'POST',
          headers: { 'X-Forwarded-For': '198.51.100.7' },
        }),
        deps,
      )
    }
    expect(
      (
        await enforceRequestRateLimit(
          new Request('https://cms.test/api/mcp', {
            method: 'POST',
            headers: { 'X-Forwarded-For': '198.51.100.7' },
          }),
          deps,
        )
      )?.status,
    ).toBe(429)
    expect(
      await enforceRequestRateLimit(
        new Request('https://cms.test/api/mcp', {
          method: 'POST',
          headers: { 'X-Forwarded-For': '203.0.113.20' },
        }),
        deps,
      ),
    ).toBeNull()
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
  describe('OAuth endpoints', () => {
    const register = (ip?: string) =>
      new Request('https://cms.test/api/auth/oauth2/register', {
        method: 'POST',
        headers: ip ? { 'x-forwarded-for': ip } : {},
      })

    it('limits anonymous registration to 20 per hour per address, when the address is known', async () => {
      const store = countingStore()
      const deps = { ...dependencies(store), trustProxy: true }
      for (let i = 0; i < 20; i += 1) {
        expect(await enforceRequestRateLimit(register('198.51.100.7'), deps)).toBeNull()
      }
      const blocked = await enforceRequestRateLimit(register('198.51.100.7'), deps)
      expect(blocked?.status).toBe(429)
      expect(blocked?.headers.get('Retry-After')).toBeTruthy()
      // Another address has its own budget.
      expect(await enforceRequestRateLimit(register('198.51.100.8'), deps)).toBeNull()
    })

    it('caps all registrations deployment-wide at 300 per hour when no address is known', async () => {
      const store = countingStore()
      const deps = dependencies(store)
      for (let i = 0; i < 300; i += 1) {
        expect(await enforceRequestRateLimit(register(), deps)).toBeNull()
      }
      expect((await enforceRequestRateLimit(register(), deps))?.status).toBe(429)
    })

    it('limits token requests to 60 per minute per client and address', async () => {
      const store = countingStore()
      const deps = { ...dependencies(store), trustProxy: true }
      const token = (clientId: string) =>
        new Request('https://cms.test/api/auth/oauth2/token', {
          method: 'POST',
          headers: {
            'content-type': 'application/x-www-form-urlencoded',
            'x-forwarded-for': '198.51.100.9',
          },
          body: new URLSearchParams({ grant_type: 'refresh_token', client_id: clientId }),
        })
      for (let i = 0; i < 60; i += 1) {
        expect(await enforceRequestRateLimit(token('client-a'), deps)).toBeNull()
      }
      expect((await enforceRequestRateLimit(token('client-a'), deps))?.status).toBe(429)
      // A different client from the same address is counted separately.
      expect(await enforceRequestRateLimit(token('client-b'), deps)).toBeNull()
    })

    it('keeps the rest of the auth API exempt', async () => {
      const store = countingStore()
      const deps = dependencies(store)
      for (let i = 0; i < 100; i += 1) {
        expect(
          await enforceRequestRateLimit(
            new Request('https://cms.test/api/auth/oauth2/authorize?client_id=x', { method: 'GET' }),
            deps,
          ),
        ).toBeNull()
      }
      expect(store.keys).toHaveLength(0)
    })

    it('applies the per-token budget to the per-site MCP endpoint', async () => {
      const store = countingStore()
      const deps = dependencies(store)
      const request = new Request('https://cms.test/api/mcp/acme-site', {
        method: 'POST',
        headers: { authorization: 'Bearer areca_at_example' },
      })
      expect(await enforceRequestRateLimit(request, deps)).toBeNull()
      expect(store.keys.some((key) => key.includes(':mcp:'))).toBe(true)
    })
  })
})
