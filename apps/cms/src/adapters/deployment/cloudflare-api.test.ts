import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  CloudflareApiError,
  createCloudflareClient,
  isValidCloudflareAccountId,
} from './cloudflare-api'

const ACCOUNT_ID = '0123456789abcdef0123456789abcdef'
const TOKEN = 'cfut_test_token_1234'

type Route = (url: URL, init: RequestInit) => Response | Promise<Response>

/** A fetch that answers by path; unknown paths fail the test. */
function routedFetch(routes: Record<string, Route>) {
  const calls: { url: URL; init: RequestInit }[] = []
  const fetchFn: typeof fetch = async (input, init) => {
    const url = new URL(String(input))
    calls.push({ url, init: init ?? {} })
    const route = (routes as Partial<Record<string, Route>>)[url.pathname]
    if (!route)
      return json(404, { success: false, errors: [{ message: 'no route' }] })
    return route(url, init ?? {})
  }
  return { fetchFn, calls }
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function ok(result: unknown) {
  return json(200, { success: true, errors: [], messages: [], result })
}

function fail(status: number, messages: string[]) {
  return json(status, {
    success: false,
    errors: messages.map((message, index) => ({ code: 1000 + index, message })),
    messages: [],
    result: null,
  })
}

const ACTIVE = {
  '/client/v4/user/tokens/verify': () => ok({ id: 't', status: 'active' }),
}
const BASE = 'https://api.cloudflare.com/client/v4'
const ROUTE_PREFIX = '/client/v4'

function pagesRoutes(list: Route) {
  return { [`${ROUTE_PREFIX}/accounts/${ACCOUNT_ID}/pages/projects`]: list }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('createCloudflareClient', () => {
  it('rejects a malformed account ID before any request', () => {
    expect(() =>
      createCloudflareClient({ apiToken: TOKEN, accountId: 'not-an-id' }),
    ).toThrow(/32 hexadecimal/)
    expect(isValidCloudflareAccountId(ACCOUNT_ID.toUpperCase())).toBe(true)
    expect(isValidCloudflareAccountId(`${ACCOUNT_ID}0`)).toBe(false)
    expect(isValidCloudflareAccountId(ACCOUNT_ID.replace('a', 'g'))).toBe(false)
  })

  it('sends the bearer token and honours the base URL override', async () => {
    const { fetchFn, calls } = routedFetch({
      '/stub/user/tokens/verify': () => ok({ id: 't', status: 'active' }),
    })
    const client = createCloudflareClient({
      apiToken: TOKEN,
      accountId: ACCOUNT_ID,
      fetch: fetchFn,
      baseUrl: 'http://127.0.0.1:4607/stub/',
    })

    await expect(client.verifyToken()).resolves.toEqual({ status: 'active' })
    expect(calls[0].url.toString()).toBe(
      'http://127.0.0.1:4607/stub/user/tokens/verify',
    )
    const headers = new Headers(calls[0].init.headers)
    expect(headers.get('authorization')).toBe(`Bearer ${TOKEN}`)
  })

  it('defaults to the public Cloudflare API', async () => {
    const { fetchFn, calls } = routedFetch({
      [`${ROUTE_PREFIX}/user/tokens/verify`]: () => ok({ status: 'active' }),
    })
    await createCloudflareClient({
      apiToken: TOKEN,
      accountId: ACCOUNT_ID,
      fetch: fetchFn,
    }).verifyToken()
    expect(calls[0].url.origin + calls[0].url.pathname).toBe(
      `${BASE}/user/tokens/verify`,
    )
  })
})

describe('error envelopes', () => {
  it('reports Cloudflare error messages and the HTTP status', async () => {
    const { fetchFn } = routedFetch({
      ...pagesRoutes(() =>
        fail(403, ['Authentication error', 'Missing scope']),
      ),
    })
    const client = createCloudflareClient({
      apiToken: TOKEN,
      accountId: ACCOUNT_ID,
      fetch: fetchFn,
    })

    const error = await client.listPagesProjects().catch((err: unknown) => err)
    expect(error).toBeInstanceOf(CloudflareApiError)
    expect((error as CloudflareApiError).status).toBe(403)
    expect((error as Error).message).toBe(
      'Cloudflare Pages projects failed (HTTP 403): Authentication error; Missing scope',
    )
  })

  it('treats success:false on a 200 as a failure', async () => {
    const { fetchFn } = routedFetch({
      [`${ROUTE_PREFIX}/accounts/${ACCOUNT_ID}/workers/scripts`]: () =>
        json(200, { success: false, errors: [{ message: 'nope' }] }),
    })
    const client = createCloudflareClient({
      apiToken: TOKEN,
      accountId: ACCOUNT_ID,
      fetch: fetchFn,
    })
    await expect(client.listWorkers()).rejects.toThrow(
      'Cloudflare Workers scripts failed (HTTP 200): nope',
    )
  })

  it('handles a non-JSON error body without leaking it', async () => {
    const { fetchFn } = routedFetch({
      [`${ROUTE_PREFIX}/user/tokens/verify`]: () =>
        new Response('<html>Bad gateway</html>', { status: 502 }),
    })
    const client = createCloudflareClient({
      apiToken: TOKEN,
      accountId: ACCOUNT_ID,
      fetch: fetchFn,
    })
    const error = await client.verifyToken().catch((err: unknown) => err)
    expect((error as Error).message).toBe(
      'Cloudflare token verification failed (HTTP 502): no details returned',
    )
    expect((error as Error).message).not.toContain(TOKEN)
  })

  it('reports a network failure without throwing a raw fetch error', async () => {
    const client = createCloudflareClient({
      apiToken: TOKEN,
      accountId: ACCOUNT_ID,
      fetch: async () => {
        throw new TypeError('fetch failed')
      },
    })
    await expect(client.verifyToken()).rejects.toThrow(
      'Could not reach Cloudflare for token verification',
    )
  })

  it('times out after 15 seconds', async () => {
    vi.useFakeTimers()
    const client = createCloudflareClient({
      apiToken: TOKEN,
      accountId: ACCOUNT_ID,
      fetch: (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          )
        }),
    })
    const pending = client.verifyToken().catch((err: unknown) => err)
    await vi.advanceTimersByTimeAsync(15_000)
    const error = await pending
    expect((error as Error).message).toBe(
      'Cloudflare token verification did not answer within 15 seconds',
    )
  })
})

describe('verifyToken', () => {
  it.each(['active', 'disabled', 'expired'] as const)(
    'maps the %s status',
    async (status) => {
      const { fetchFn } = routedFetch({
        [`${ROUTE_PREFIX}/user/tokens/verify`]: () =>
          ok({ id: 't', status, expires_on: '2027-01-01T00:00:00Z' }),
      })
      const client = createCloudflareClient({
        apiToken: TOKEN,
        accountId: ACCOUNT_ID,
        fetch: fetchFn,
      })
      await expect(client.verifyToken()).resolves.toEqual({
        status,
        expiresOn: '2027-01-01T00:00:00Z',
      })
    },
  )

  it('rejects an unknown status', async () => {
    const { fetchFn } = routedFetch({
      [`${ROUTE_PREFIX}/user/tokens/verify`]: () => ok({ status: 'pending' }),
    })
    const client = createCloudflareClient({
      apiToken: TOKEN,
      accountId: ACCOUNT_ID,
      fetch: fetchFn,
    })
    await expect(client.verifyToken()).rejects.toThrow(
      'unexpected token status',
    )
  })
})

describe('listPagesProjects', () => {
  it('maps projects and keeps the git source type', async () => {
    const { fetchFn } = routedFetch({
      ...pagesRoutes(() =>
        ok([
          {
            name: 'northbound',
            subdomain: 'northbound.pages.dev',
            domains: ['northbound.example.com'],
            production_branch: 'main',
            source: { type: 'github', config: {} },
          },
          {
            name: 'direct-upload',
            subdomain: 'direct-upload.pages.dev',
            domains: [],
            production_branch: 'main',
          },
          { subdomain: 'no-name' },
        ]),
      ),
    })
    const client = createCloudflareClient({
      apiToken: TOKEN,
      accountId: ACCOUNT_ID,
      fetch: fetchFn,
    })
    await expect(client.listPagesProjects()).resolves.toEqual([
      {
        name: 'northbound',
        subdomain: 'northbound.pages.dev',
        domains: ['northbound.example.com'],
        productionBranch: 'main',
        sourceType: 'github',
      },
      {
        name: 'direct-upload',
        subdomain: 'direct-upload.pages.dev',
        domains: [],
        productionBranch: 'main',
        sourceType: null,
      },
    ])
  })

  it('pages until a short page and stops there', async () => {
    const full = Array.from({ length: 10 }, (_, i) => ({ name: `p-${i}` }))
    const seen: string[] = []
    const { fetchFn } = routedFetch({
      ...pagesRoutes((url) => {
        seen.push(url.searchParams.get('page') ?? '')
        const page = Number(url.searchParams.get('page'))
        expect(url.searchParams.get('per_page')).toBe('10')
        return ok(page === 1 ? full : [{ name: 'last' }])
      }),
    })
    const client = createCloudflareClient({
      apiToken: TOKEN,
      accountId: ACCOUNT_ID,
      fetch: fetchFn,
    })
    const projects = await client.listPagesProjects()
    expect(projects).toHaveLength(11)
    expect(seen).toEqual(['1', '2'])
  })

  it('caps pagination at 50 pages', async () => {
    const full = Array.from({ length: 10 }, (_, i) => ({ name: `p-${i}` }))
    let requests = 0
    const { fetchFn } = routedFetch({
      ...pagesRoutes(() => {
        requests += 1
        return ok(full)
      }),
    })
    const client = createCloudflareClient({
      apiToken: TOKEN,
      accountId: ACCOUNT_ID,
      fetch: fetchFn,
    })
    const projects = await client.listPagesProjects()
    expect(requests).toBe(50)
    expect(projects).toHaveLength(500)
  })
})

describe('listWorkers and listWorkerTriggers', () => {
  it('maps scripts to name and tag', async () => {
    const { fetchFn } = routedFetch({
      [`${ROUTE_PREFIX}/accounts/${ACCOUNT_ID}/workers/scripts`]: () =>
        ok([{ id: 'northbound-worker', tag: 'tag-1' }, { id: 'broken' }]),
    })
    const client = createCloudflareClient({
      apiToken: TOKEN,
      accountId: ACCOUNT_ID,
      fetch: fetchFn,
    })
    await expect(client.listWorkers()).resolves.toEqual([
      { name: 'northbound-worker', tag: 'tag-1' },
    ])
  })

  it('maps triggers defensively and encodes the tag', async () => {
    const { fetchFn, calls } = routedFetch({
      [`${ROUTE_PREFIX}/accounts/${ACCOUNT_ID}/builds/workers/tag%201/triggers`]:
        () =>
          ok([
            {
              trigger_uuid: 'trg-1',
              trigger_name: 'main',
              branch_includes: ['main', 7],
              build_command: 'pnpm build',
              deploy_command: 'npx wrangler deploy',
              unexpected: true,
            },
            'garbage',
          ]),
    })
    const client = createCloudflareClient({
      apiToken: TOKEN,
      accountId: ACCOUNT_ID,
      fetch: fetchFn,
    })
    const triggers = await client.listWorkerTriggers('tag 1')
    expect(calls.at(-1)?.url.pathname).toContain('/workers/tag%201/triggers')
    expect(triggers).toEqual([
      {
        triggerUuid: 'trg-1',
        triggerName: 'main',
        branchIncludes: ['main'],
        buildCommand: 'pnpm build',
        deployCommand: 'npx wrangler deploy',
      },
      {
        triggerUuid: null,
        triggerName: null,
        branchIncludes: [],
        buildCommand: null,
        deployCommand: null,
      },
    ])
  })
})

describe('checkPermissions', () => {
  it('passes every check for a fully permitted token', async () => {
    const { fetchFn } = routedFetch({
      ...ACTIVE,
      ...pagesRoutes(() => ok([{ name: 'a' }, { name: 'b' }])),
      [`${ROUTE_PREFIX}/accounts/${ACCOUNT_ID}/workers/scripts`]: () =>
        ok([{ id: 'w', tag: 'tag-w' }]),
      [`${ROUTE_PREFIX}/accounts/${ACCOUNT_ID}/builds/workers/tag-w/triggers`]:
        () => ok([{ trigger_uuid: 't' }]),
    })
    const client = createCloudflareClient({
      apiToken: TOKEN,
      accountId: ACCOUNT_ID,
      fetch: fetchFn,
    })
    await expect(client.checkPermissions()).resolves.toEqual({
      token: { ok: true, status: 'active' },
      pages: { ok: true, count: 2 },
      workersScripts: { ok: true, count: 1 },
      workersCi: { ok: true, count: 1 },
    })
  })

  it('reports a partial failure per permission without throwing', async () => {
    const { fetchFn } = routedFetch({
      ...ACTIVE,
      ...pagesRoutes(() => fail(403, ['Authentication error'])),
      [`${ROUTE_PREFIX}/accounts/${ACCOUNT_ID}/workers/scripts`]: () =>
        ok([{ id: 'w', tag: 'tag-w' }]),
      [`${ROUTE_PREFIX}/accounts/${ACCOUNT_ID}/builds/workers/tag-w/triggers`]:
        () => fail(403, ['Insufficient permissions for Workers CI']),
    })
    const client = createCloudflareClient({
      apiToken: TOKEN,
      accountId: ACCOUNT_ID,
      fetch: fetchFn,
    })
    const checks = await client.checkPermissions()
    expect(checks.token).toEqual({ ok: true, status: 'active' })
    expect(checks.pages.ok).toBe(false)
    expect(checks.pages.message).toContain('Authentication error')
    expect(checks.workersScripts).toEqual({ ok: true, count: 1 })
    expect(checks.workersCi.ok).toBe(false)
    expect(checks.workersCi.message).toContain('Workers CI')
  })

  it('skips the Workers CI check when the account has no Workers', async () => {
    const { fetchFn, calls } = routedFetch({
      ...ACTIVE,
      ...pagesRoutes(() => ok([])),
      [`${ROUTE_PREFIX}/accounts/${ACCOUNT_ID}/workers/scripts`]: () => ok([]),
    })
    const client = createCloudflareClient({
      apiToken: TOKEN,
      accountId: ACCOUNT_ID,
      fetch: fetchFn,
    })
    const checks = await client.checkPermissions()
    expect(checks.workersCi).toEqual({ ok: false, skipped: 'no-workers' })
    expect(calls.some((call) => call.url.pathname.includes('/builds/'))).toBe(
      false,
    )
  })

  it('reports Workers CI as unavailable when the Workers list fails', async () => {
    const { fetchFn } = routedFetch({
      ...ACTIVE,
      ...pagesRoutes(() => ok([])),
      [`${ROUTE_PREFIX}/accounts/${ACCOUNT_ID}/workers/scripts`]: () =>
        fail(403, ['Forbidden']),
    })
    const client = createCloudflareClient({
      apiToken: TOKEN,
      accountId: ACCOUNT_ID,
      fetch: fetchFn,
    })
    const checks = await client.checkPermissions()
    expect(checks.workersScripts.ok).toBe(false)
    expect(checks.workersCi).toEqual({
      ok: false,
      skipped: 'workers-unavailable',
    })
  })

  it('skips every check when the token is disabled or expired', async () => {
    const { fetchFn, calls } = routedFetch({
      [`${ROUTE_PREFIX}/user/tokens/verify`]: () =>
        ok({ status: 'expired', expires_on: '2026-01-01T00:00:00Z' }),
    })
    const client = createCloudflareClient({
      apiToken: TOKEN,
      accountId: ACCOUNT_ID,
      fetch: fetchFn,
    })
    const checks = await client.checkPermissions()
    expect(checks.token).toEqual({
      ok: false,
      status: 'expired',
      expiresOn: '2026-01-01T00:00:00Z',
    })
    expect(checks.pages).toEqual({ ok: false, skipped: 'token-inactive' })
    expect(checks.workersScripts).toEqual({
      ok: false,
      skipped: 'token-inactive',
    })
    expect(checks.workersCi).toEqual({ ok: false, skipped: 'token-inactive' })
    expect(calls).toHaveLength(1)
  })

  it('marks a token Cloudflare rejects as invalid, with its message', async () => {
    const { fetchFn } = routedFetch({
      [`${ROUTE_PREFIX}/user/tokens/verify`]: () =>
        fail(401, ['Invalid API Token']),
    })
    const client = createCloudflareClient({
      apiToken: TOKEN,
      accountId: ACCOUNT_ID,
      fetch: fetchFn,
    })
    const checks = await client.checkPermissions()
    expect(checks.token.ok).toBe(false)
    expect(checks.token.status).toBe('invalid')
    expect(checks.token.message).toContain('Invalid API Token')
    expect(checks.pages.skipped).toBe('token-inactive')
  })

  it('marks a verify call that never answers as unknown', async () => {
    const client = createCloudflareClient({
      apiToken: TOKEN,
      accountId: ACCOUNT_ID,
      fetch: async () => {
        throw new TypeError('socket hang up')
      },
    })
    const checks = await client.checkPermissions()
    expect(checks.token.status).toBe('unknown')
    expect(checks.token.message).toContain('Could not reach Cloudflare')
  })
})
