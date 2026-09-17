import { describe, expect, it } from 'vitest'
import { createDokployAdapter, listDokployApplications } from './dokploy'
import type { DeploymentTarget } from './types'

const target: DeploymentTarget = {
  provider: 'dokploy',
  applicationId: 'app-1',
  healthCheckUrl: 'http://site.test',
}

type Handler = (url: string, init?: RequestInit) => Promise<Response> | Response

function fakeFetch(handler: Handler): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url
    return handler(url, init)
  }
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const localTestOptions = {
  allowInsecureHttp: true,
  resolveHost: async () => ['93.184.216.34'],
}

describe('createDokployAdapter', () => {
  it('verifies credentials and paginates organization applications', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const applications = Array.from({ length: 101 }, (_, index) => ({
      applicationId: `app-${index}`,
      name: `Application ${index}`,
      appName: `application-${index}`,
      applicationStatus: index === 0 ? 'done' : 'idle',
    }))

    const result = await listDokployApplications({
      baseUrl: 'https://dokploy.example.com',
      apiKey: 'organization-key',
      fetch: fakeFetch((url, init) => {
        calls.push({ url, init })
        const offset = Number(new URL(url).searchParams.get('offset'))
        return json({
          items: applications.slice(offset, offset + 100),
          total: 101,
        })
      }),
    })

    expect(result).toEqual({ applications, total: 101 })
    expect(calls.map((call) => call.url)).toEqual([
      'https://dokploy.example.com/api/application.search?limit=100&offset=0',
      'https://dokploy.example.com/api/application.search?limit=100&offset=100',
    ])
    expect(calls[0]?.init).toMatchObject({
      headers: { 'x-api-key': 'organization-key' },
      redirect: 'error',
    })
  })

  it('rejects malformed application search responses', async () => {
    await expect(
      listDokployApplications({
        baseUrl: 'https://dokploy.example.com',
        apiKey: 'key',
        fetch: fakeFetch(() => json({})),
      }),
    ).rejects.toThrow(/invalid response/)
  })

  it('requires HTTPS for the Dokploy API unless local development is explicit', () => {
    expect(() =>
      createDokployAdapter({
        baseUrl: 'http://dokploy.example.com',
        apiKey: 'k',
      }),
    ).toThrow(/HTTPS/)
  })

  it('does not expose an upstream error body', async () => {
    const adapter = createDokployAdapter({
      baseUrl: 'https://dokploy.example.com',
      apiKey: 'k',
      fetch: fakeFetch(() => json({ token: 'must-not-leak' }, 500)),
    })
    const error = await adapter.deploy(target, () => {}).catch((cause) => cause)
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toContain('failed: 500')
    expect((error as Error).message).not.toContain('must-not-leak')
  })

  it('POSTs deploy then reads the newest deploymentId', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const adapter = createDokployAdapter({
      baseUrl: 'http://dokploy.test',
      apiKey: 'test-key',
      ...localTestOptions,
      fetch: fakeFetch((url, init) => {
        calls.push({ url, init })
        if (url.endsWith('/api/application.deploy')) return json(true)
        if (url.endsWith('/api/application.saveEnvironment')) return json(true)
        if (url.includes('/api/application.one')) {
          return json({
            applicationId: 'app-1',
            applicationStatus: 'running',
            env: 'PORT=3000',
            buildArgs:
              'ARECA_CMS_URL=http://cms.test\nARECA_SITE_TOKEN=legacy-secret',
            buildSecrets: '',
            createEnvFile: false,
            deployments: [
              { deploymentId: 'old', createdAt: '2026-01-01T00:00:00.000Z' },
              { deploymentId: 'new', createdAt: '2026-01-02T00:00:00.000Z' },
            ],
          })
        }
        return new Response('not found', { status: 404 })
      }),
    })

    const logs: string[] = []
    const result = await adapter.deploy(target, (line) => logs.push(line))

    expect(result.deploymentId).toBe('new')
    expect(calls.map((call) => call.url)).toEqual([
      'http://dokploy.test/api/application.one?applicationId=app-1',
      'http://dokploy.test/api/application.saveEnvironment',
      'http://dokploy.test/api/application.deploy',
      'http://dokploy.test/api/application.one?applicationId=app-1',
    ])
    expect(calls[2]?.init?.method).toBe('POST')
    expect(calls[2]?.init?.headers).toMatchObject({ 'x-api-key': 'test-key' })
    expect(JSON.parse(String(calls[2]?.init?.body))).toEqual({
      applicationId: 'app-1',
    })
    const saved = JSON.parse(String(calls[1]?.init?.body)) as {
      buildArgs: string
      buildSecrets: string
    }
    expect(saved.buildArgs).toMatch(/ARECA_SNAPSHOT_ID=\d+/)
    expect(saved.buildArgs).not.toContain('ARECA_SITE_TOKEN')
    expect(saved.buildSecrets).toBe('ARECA_SITE_TOKEN=legacy-secret')
    expect(logs.length).toBeGreaterThan(0)
  })

  it('treats an empty application.deploy body as success', async () => {
    const adapter = createDokployAdapter({
      baseUrl: 'http://dokploy.test',
      apiKey: 'k',
      ...localTestOptions,
      fetch: fakeFetch((url) => {
        if (url.endsWith('/api/application.deploy')) {
          return new Response('', { status: 200 })
        }
        if (url.endsWith('/api/application.saveEnvironment')) {
          return json(true)
        }
        return json({
          applicationId: 'app-1',
          applicationStatus: 'running',
          deployments: [
            {
              deploymentId: 'dep-empty',
              createdAt: '2026-01-02T00:00:00.000Z',
            },
          ],
        })
      }),
    })
    const result = await adapter.deploy(target, () => {})
    expect(result.deploymentId).toBe('dep-empty')
  })

  it('uses applicationId + timestamp when deployments is missing', async () => {
    const adapter = createDokployAdapter({
      baseUrl: 'http://dokploy.test',
      apiKey: 'k',
      ...localTestOptions,
      fetch: fakeFetch((url) => {
        if (url.endsWith('/api/application.deploy')) return json(true)
        if (url.endsWith('/api/application.saveEnvironment')) return json(true)
        return json({ applicationId: 'app-1', applicationStatus: 'running' })
      }),
    })
    const result = await adapter.deploy(target, () => {})
    expect(result.deploymentId).toMatch(/^app-1-\d+$/)
  })

  it('polls until applicationStatus is done', async () => {
    let polls = 0
    const adapter = createDokployAdapter({
      baseUrl: 'http://dokploy.test',
      apiKey: 'k',
      ...localTestOptions,
      fetch: fakeFetch(() => {
        polls += 1
        const status = polls < 3 ? 'running' : 'done'
        return json({ applicationStatus: status, deployments: [] })
      }),
    })

    const logs: string[] = []
    const result = await adapter.waitForCompletion(
      target,
      'dep-1',
      { timeoutMs: 500, pollMs: 10 },
      (line) => logs.push(line),
    )

    expect(result).toBe('done')
    expect(polls).toBeGreaterThanOrEqual(3)
    expect(logs).toContain('applicationStatus: running')
    expect(logs).toContain('applicationStatus: done')
  })

  it('returns error when applicationStatus is error', async () => {
    const adapter = createDokployAdapter({
      baseUrl: 'http://dokploy.test',
      apiKey: 'k',
      ...localTestOptions,
      fetch: fakeFetch(() => json({ applicationStatus: 'error' })),
    })
    const result = await adapter.waitForCompletion(
      target,
      'dep-1',
      { timeoutMs: 200, pollMs: 10 },
      () => {},
    )
    expect(result).toBe('error')
  })

  it('does not treat a leftover applicationStatus done as success', async () => {
    let polls = 0
    const adapter = createDokployAdapter({
      baseUrl: 'http://dokploy.test',
      apiKey: 'k',
      ...localTestOptions,
      fetch: fakeFetch(() => {
        polls += 1
        return json({
          applicationStatus: polls < 3 ? 'done' : 'running',
          deployments: [],
        })
      }),
    })
    const result = await adapter.waitForCompletion(
      target,
      'dep-stale',
      { timeoutMs: 80, pollMs: 10 },
      () => {},
    )
    expect(result).toBe('timeout')
    expect(polls).toBeGreaterThanOrEqual(3)
  })

  it('returns timeout when status stays running', async () => {
    const adapter = createDokployAdapter({
      baseUrl: 'http://dokploy.test',
      apiKey: 'k',
      ...localTestOptions,
      fetch: fakeFetch(() => json({ applicationStatus: 'running' })),
    })
    const result = await adapter.waitForCompletion(
      target,
      'dep-1',
      { timeoutMs: 40, pollMs: 10 },
      () => {},
    )
    expect(result).toBe('timeout')
  })

  it('retries healthCheck until 200', async () => {
    let attempts = 0
    const adapter = createDokployAdapter({
      baseUrl: 'http://dokploy.test',
      apiKey: 'k',
      ...localTestOptions,
      fetch: fakeFetch(() => {
        attempts += 1
        return new Response('', { status: attempts < 3 ? 503 : 200 })
      }),
    })
    const ok = await adapter.healthCheck('http://site.test', {
      timeoutMs: 500,
      intervalMs: 10,
    })
    expect(ok).toBe(true)
    expect(attempts).toBeGreaterThanOrEqual(3)
  })

  it('waits until health JSON matches expectPublicationId', async () => {
    let attempts = 0
    const adapter = createDokployAdapter({
      baseUrl: 'http://dokploy.test',
      apiKey: 'k',
      ...localTestOptions,
      fetch: fakeFetch(() => {
        attempts += 1
        const publicationId = attempts < 3 ? 'old' : 'pub-new'
        return json({ ok: true, publicationId })
      }),
    })
    const ok = await adapter.healthCheck('http://site.test', {
      timeoutMs: 500,
      intervalMs: 10,
      expectPublicationId: 'pub-new',
    })
    expect(ok).toBe(true)
    expect(attempts).toBeGreaterThanOrEqual(3)
  })

  it('blocks a redirect to a private health-check target', async () => {
    let attempts = 0
    const adapter = createDokployAdapter({
      baseUrl: 'https://dokploy.example.com',
      apiKey: 'k',
      resolveHost: async (hostname) =>
        hostname === 'public.example' ? ['93.184.216.34'] : ['127.0.0.1'],
      fetch: fakeFetch(() => {
        attempts += 1
        return new Response(null, {
          status: 302,
          headers: { location: 'http://127.0.0.1/admin' },
        })
      }),
    })

    const ok = await adapter.healthCheck('https://public.example/health', {
      timeoutMs: 20,
      intervalMs: 5,
    })
    expect(ok).toBe(false)
    expect(attempts).toBeGreaterThan(0)
  })
})
