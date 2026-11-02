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
        deletedOn: null,
      },
      {
        triggerUuid: null,
        triggerName: null,
        branchIncludes: [],
        buildCommand: null,
        deployCommand: null,
        deletedOn: null,
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

const ACCOUNT_PATH = `${ROUTE_PREFIX}/accounts/${ACCOUNT_ID}`
const PROJECT_PATH = `${ACCOUNT_PATH}/pages/projects/areca-site`
const TRIGGER = '11111111-2222-4333-8444-555555555555'
const SCRIPT_TAG = 'a'.repeat(32)

function pagesDeploymentRaw(
  id: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    id,
    short_id: id.slice(0, 8),
    url: `https://${id}.areca-site.pages.dev`,
    environment: 'production',
    deployment_trigger: {
      type: 'ad_hoc',
      metadata: { branch: 'main', commit_hash: 'abc123' },
    },
    latest_stage: { name: 'build', status: 'active' },
    stages: [{ name: 'build', status: 'active' }],
    created_on: '2026-11-02T10:00:00.000Z',
    ...overrides,
  }
}

function workerBuildRaw(uuid: string, overrides: Record<string, unknown> = {}) {
  return {
    build_uuid: uuid,
    status: 'queued',
    build_outcome: null,
    created_on: '2026-11-02T10:00:00.000Z',
    trigger: { trigger_uuid: TRIGGER },
    build_trigger_metadata: { build_trigger_source: 'manual', branch: 'main' },
    ...overrides,
  }
}

/** A fetch that rejects with a connection error code, as Node's fetch does. */
function failingFetch(code: string): typeof fetch {
  return async () => {
    throw new TypeError('fetch failed', {
      cause: Object.assign(new Error(code), { code }),
    })
  }
}

describe('Pages and Workers Builds calls', () => {
  it('posts a Pages build as form data carrying only the branch', async () => {
    const { fetchFn, calls } = routedFetch({
      [`${PROJECT_PATH}/deployments`]: (_url, init) => {
        if (init.method === 'POST') return ok(pagesDeploymentRaw('dep-1'))
        return ok([pagesDeploymentRaw('dep-1')])
      },
    })
    const client = createCloudflareClient({
      apiToken: TOKEN,
      accountId: ACCOUNT_ID,
      fetch: fetchFn,
    })
    const created = await client.createPagesDeployment('areca-site', 'main')
    expect(created).toMatchObject({
      id: 'dep-1',
      environment: 'production',
      trigger: { type: 'ad_hoc', branch: 'main', commitHash: 'abc123' },
    })
    const post = calls[0]
    expect(post.init.method).toBe('POST')
    expect(post.init.body).toBeInstanceOf(FormData)
    expect((post.init.body as FormData).get('branch')).toBe('main')
    expect(
      (post.init.headers as Record<string, string>)['content-type'],
    ).toBeUndefined()
  })

  it('reads a Pages deployment and filters the list to production', async () => {
    const { fetchFn, calls } = routedFetch({
      [`${PROJECT_PATH}/deployments/dep-1`]: () =>
        ok(pagesDeploymentRaw('dep-1')),
      [`${PROJECT_PATH}/deployments`]: () =>
        ok([pagesDeploymentRaw('dep-1'), { no: 'id' }]),
    })
    const client = createCloudflareClient({
      apiToken: TOKEN,
      accountId: ACCOUNT_ID,
      fetch: fetchFn,
    })
    expect((await client.getPagesDeployment('areca-site', 'dep-1')).id).toBe(
      'dep-1',
    )
    const list = await client.listPagesDeployments('areca-site', {
      environment: 'production',
    })
    expect(list.map((item) => item.id)).toEqual(['dep-1'])
    expect(calls.at(-1)?.url.searchParams.get('env')).toBe('production')
  })

  it('maps Pages deployment logs and the project production branch', async () => {
    const { fetchFn } = routedFetch({
      [`${PROJECT_PATH}/deployments/dep-1/history/logs`]: () =>
        ok({
          data: [
            { ts: 1, line: 'first' },
            { ts: 2, line: 'second' },
          ],
        }),
      [PROJECT_PATH]: () =>
        ok({
          name: 'areca-site',
          subdomain: 'areca-site.pages.dev',
          domains: ['www.example.test'],
          source: { type: 'github', config: { production_branch: 'trunk' } },
        }),
    })
    const client = createCloudflareClient({
      apiToken: TOKEN,
      accountId: ACCOUNT_ID,
      fetch: fetchFn,
    })
    expect(await client.getPagesDeploymentLogs('areca-site', 'dep-1')).toEqual([
      'first',
      'second',
    ])
    expect(await client.getPagesProject('areca-site')).toMatchObject({
      productionBranch: 'trunk',
      sourceType: 'github',
      domains: ['www.example.test'],
    })
  })

  it('creates a Workers build with a JSON branch body and never retries it', async () => {
    const { fetchFn, calls } = routedFetch({
      [`${ACCOUNT_PATH}/builds/triggers/${TRIGGER}/builds`]: () =>
        ok({
          build_uuid: 'build-1',
          status: 'queued',
          build_outcome: null,
          created_on: '2026-11-02T10:00:00.000Z',
          trigger: { trigger_uuid: TRIGGER },
        }),
    })
    const client = createCloudflareClient({
      apiToken: TOKEN,
      accountId: ACCOUNT_ID,
      fetch: fetchFn,
    })
    const build = await client.createWorkerBuild(TRIGGER, 'main')
    expect(build).toMatchObject({
      buildUuid: 'build-1',
      status: 'queued',
      buildOutcome: null,
      triggerUuid: TRIGGER,
      buildTriggerSource: null,
    })
    expect(calls).toHaveLength(1)
    expect(calls[0].init.method).toBe('POST')
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ branch: 'main' })
  })

  it('lists Worker builds newest-first with a page size and reads their metadata', async () => {
    const { fetchFn, calls } = routedFetch({
      [`${ACCOUNT_PATH}/builds/workers/${SCRIPT_TAG}/builds`]: () =>
        ok([
          workerBuildRaw('build-2', {
            status: 'stopped',
            build_outcome: 'success',
            build_trigger_metadata: {
              build_trigger_source: 'push_event',
              branch: 'main',
            },
          }),
          workerBuildRaw('build-1'),
        ]),
    })
    const client = createCloudflareClient({
      apiToken: TOKEN,
      accountId: ACCOUNT_ID,
      fetch: fetchFn,
    })
    const builds = await client.listWorkerBuilds(SCRIPT_TAG)
    expect(builds.map((item) => item.buildUuid)).toEqual(['build-2', 'build-1'])
    expect(builds[0]).toMatchObject({
      buildOutcome: 'success',
      buildTriggerSource: 'push_event',
    })
    expect(calls[0].url.searchParams.get('per_page')).toBe('50')
  })

  it('follows the log cursor while truncated and keeps every page in order', async () => {
    const { fetchFn, calls } = routedFetch({
      [`${ACCOUNT_PATH}/builds/builds/build-1/logs`]: (url) => {
        if (url.searchParams.get('cursor') === 'c1') {
          return ok({
            cursor: 'c2',
            truncated: false,
            lines: [[3, 'line 3']],
            events: [],
          })
        }
        return ok({
          cursor: 'c1',
          truncated: true,
          lines: [
            [1, 'line 1'],
            [2, 'line 2'],
          ],
          events: [],
        })
      },
    })
    const client = createCloudflareClient({
      apiToken: TOKEN,
      accountId: ACCOUNT_ID,
      fetch: fetchFn,
    })
    expect(await client.getWorkerBuildLogs('build-1')).toEqual([
      'line 1',
      'line 2',
      'line 3',
    ])
    expect(calls.map((call) => call.url.searchParams.get('cursor'))).toEqual([
      null,
      'c1',
    ])
  })

  it('cancels a build and reads the workers.dev and custom domain settings', async () => {
    const { fetchFn } = routedFetch({
      [`${ACCOUNT_PATH}/builds/builds/build-1/cancel`]: (_url, init) => {
        expect(init.method).toBe('PUT')
        return ok(
          workerBuildRaw('build-1', {
            status: 'stopped',
            build_outcome: 'cancelled',
          }),
        )
      },
      [`${ACCOUNT_PATH}/workers/subdomain`]: () =>
        ok({ subdomain: 'areca-team' }),
      [`${ACCOUNT_PATH}/workers/scripts/areca-worker/subdomain`]: () =>
        ok({ enabled: true, previews_enabled: false }),
      [`${ACCOUNT_PATH}/workers/domains`]: () =>
        ok([{ hostname: 'site.example.test' }, { id: 'no-host' }]),
    })
    const client = createCloudflareClient({
      apiToken: TOKEN,
      accountId: ACCOUNT_ID,
      fetch: fetchFn,
    })
    expect((await client.cancelWorkerBuild('build-1')).buildOutcome).toBe(
      'cancelled',
    )
    expect(await client.getWorkersSubdomain()).toBe('areca-team')
    expect(await client.getWorkerScriptSubdomain('areca-worker')).toEqual({
      enabled: true,
      previewsEnabled: false,
    })
    expect(await client.listWorkerDomains('areca-worker')).toEqual([
      'site.example.test',
    ])
  })
})

describe('build variable writes', () => {
  it('sets a Workers Builds trigger variable with a PATCH JSON body', async () => {
    const { fetchFn, calls } = routedFetch({
      [`${ACCOUNT_PATH}/builds/triggers/${TRIGGER}/environment_variables`]:
        () => ok({}),
    })
    const client = createCloudflareClient({
      apiToken: TOKEN,
      accountId: ACCOUNT_ID,
      fetch: fetchFn,
    })
    await expect(
      client.setWorkerBuildVariable(TRIGGER, 'ARECA_SNAPSHOT_ID', 'pub-1'),
    ).resolves.toBeUndefined()
    expect(calls).toHaveLength(1)
    expect(calls[0].init.method).toBe('PATCH')
    expect(calls[0].url.toString()).toBe(
      `${BASE}/accounts/${ACCOUNT_ID}/builds/triggers/${TRIGGER}/environment_variables`,
    )
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      ARECA_SNAPSHOT_ID: { is_secret: false, value: 'pub-1' },
    })
    const headers = new Headers(calls[0].init.headers)
    expect(headers.get('authorization')).toBe(`Bearer ${TOKEN}`)
    expect(headers.get('content-type')).toBe('application/json')
    expect(headers.get('accept')).toBe('application/json')
  })

  it('sets a Pages production env var with a PATCH JSON body', async () => {
    const { fetchFn, calls } = routedFetch({
      [`${ACCOUNT_PATH}/pages/projects/areca-site`]: () => ok({}),
    })
    const client = createCloudflareClient({
      apiToken: TOKEN,
      accountId: ACCOUNT_ID,
      fetch: fetchFn,
    })
    await expect(
      client.setPagesProductionBuildVariable(
        'areca-site',
        'ARECA_SNAPSHOT_ID',
        'pub-1',
      ),
    ).resolves.toBeUndefined()
    expect(calls).toHaveLength(1)
    expect(calls[0].init.method).toBe('PATCH')
    expect(calls[0].url.toString()).toBe(
      `${BASE}/accounts/${ACCOUNT_ID}/pages/projects/areca-site`,
    )
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      deployment_configs: {
        production: {
          env_vars: {
            ARECA_SNAPSHOT_ID: { type: 'plain_text', value: 'pub-1' },
          },
        },
      },
    })
    const headers = new Headers(calls[0].init.headers)
    expect(headers.get('authorization')).toBe(`Bearer ${TOKEN}`)
    expect(headers.get('content-type')).toBe('application/json')
  })

  it('throws CloudflareApiError for an error envelope on either write', async () => {
    const refuse = routedFetch({
      [`${ACCOUNT_PATH}/builds/triggers/${TRIGGER}/environment_variables`]:
        () => fail(403, ['Missing scope']),
      [`${ACCOUNT_PATH}/pages/projects/areca-site`]: () =>
        fail(403, ['Missing scope']),
    })
    const client = createCloudflareClient({
      apiToken: TOKEN,
      accountId: ACCOUNT_ID,
      fetch: refuse.fetchFn,
    })
    const workers = await client
      .setWorkerBuildVariable(TRIGGER, 'ARECA_SNAPSHOT_ID', 'pub-1')
      .catch((error: unknown) => error)
    expect(workers).toBeInstanceOf(CloudflareApiError)
    expect((workers as CloudflareApiError).message).toBe(
      'Cloudflare Workers Builds variables failed (HTTP 403): Missing scope',
    )
    expect((workers as CloudflareApiError).notDispatched).toBe(true)

    const pages = await client
      .setPagesProductionBuildVariable(
        'areca-site',
        'ARECA_SNAPSHOT_ID',
        'pub-1',
      )
      .catch((error: unknown) => error)
    expect(pages).toBeInstanceOf(CloudflareApiError)
    expect((pages as CloudflareApiError).message).toBe(
      'Cloudflare Pages project variables failed (HTTP 403): Missing scope',
    )
  })
})

describe('error classification for writes', () => {
  async function postError(fetchFn: typeof fetch) {
    const client = createCloudflareClient({
      apiToken: TOKEN,
      accountId: ACCOUNT_ID,
      fetch: fetchFn,
    })
    return client.createWorkerBuild(TRIGGER, 'main').then(
      () => null,
      (error: unknown) => error as CloudflareApiError,
    )
  }

  it('marks a 4xx with a Cloudflare error envelope as not dispatched', async () => {
    for (const status of [400, 403, 404, 409, 422, 429]) {
      const error = await postError(
        routedFetch({
          [`${ACCOUNT_PATH}/builds/triggers/${TRIGGER}/builds`]: () =>
            fail(status, ['Trigger not found']),
        }).fetchFn,
      )
      expect(error, `status ${status}`).toBeInstanceOf(CloudflareApiError)
      expect(error?.notDispatched, `status ${status}`).toBe(true)
    }
  })

  it('keeps 5xx, 408 and an unparseable 2xx uncertain', async () => {
    const routes = (response: () => Response) => ({
      [`${ACCOUNT_PATH}/builds/triggers/${TRIGGER}/builds`]: response,
    })
    const cases = [
      () => fail(500, ['internal']),
      () => fail(503, []),
      () => fail(408, ['request timeout']),
      () => new Response('<html>gateway</html>', { status: 200 }),
      () => json(200, { success: true, result: 'not a build' }),
    ]
    for (const response of cases) {
      const error = await postError(routedFetch(routes(response)).fetchFn)
      expect(error?.notDispatched).toBe(false)
    }
  })

  it('marks a refused connection as not dispatched and a reset as uncertain', async () => {
    const refused = await postError(failingFetch('ECONNREFUSED'))
    expect(refused?.notDispatched).toBe(true)
    const dnsFailure = await postError(failingFetch('ENOTFOUND'))
    expect(dnsFailure?.notDispatched).toBe(true)
    const reset = await postError(failingFetch('ECONNRESET'))
    expect(reset?.notDispatched).toBe(false)
  })

  it('treats a POST that never answers within 15 seconds as uncertain', async () => {
    vi.useFakeTimers()
    const fetchFn: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new Error('aborted')),
        )
      })
    const client = createCloudflareClient({
      apiToken: TOKEN,
      accountId: ACCOUNT_ID,
      fetch: fetchFn,
    })
    const pending = client
      .createWorkerBuild(TRIGGER, 'main')
      .catch((error: unknown) => error as CloudflareApiError)
    await vi.advanceTimersByTimeAsync(15_000)
    const error = await pending
    expect(error).toBeInstanceOf(CloudflareApiError)
    expect((error as CloudflareApiError).message).toContain('did not answer')
    expect((error as CloudflareApiError).notDispatched).toBe(false)
  })
})
