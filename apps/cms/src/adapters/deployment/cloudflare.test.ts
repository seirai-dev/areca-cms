import { describe, expect, it, vi } from 'vitest'

import { createCloudflareAdapter } from './cloudflare'
import { createCloudflareClient } from './cloudflare-api'
import { DeploymentNotDispatchedError, DeploymentUncertainError } from './types'
import type {
  CloudflarePagesDeploymentTarget,
  CloudflareWorkersDeploymentTarget,
  DeploymentContext,
} from './types'

const ACCOUNT_ID = '0123456789abcdef0123456789abcdef'
const TOKEN = 'cfut_test_token_1234'
const BASE = '/client/v4'
const ACCOUNT = `${BASE}/accounts/${ACCOUNT_ID}`
const PROJECT = 'areca-site'
const SCRIPT_TAG = 'b'.repeat(32)
const TRIGGER = '11111111-2222-4333-8444-555555555555'
const DISPATCHED_AT = new Date('2026-11-02T10:00:00.000Z')
const AFTER = '2026-11-02T10:00:05.000Z'
const BEFORE_WINDOW = '2026-11-02T09:59:50.000Z'
const SKEW_OK = '2026-11-02T09:59:57.000Z'

const pagesTarget: CloudflarePagesDeploymentTarget = {
  provider: 'cloudflare',
  kind: 'pages',
  projectName: PROJECT,
  branch: 'main',
  healthCheckUrl: 'https://site.example.test/health',
}

const workersTarget: CloudflareWorkersDeploymentTarget = {
  provider: 'cloudflare',
  kind: 'workers',
  scriptName: 'areca-worker',
  scriptTag: SCRIPT_TAG,
  triggerUuid: TRIGGER,
  branch: 'main',
  healthCheckUrl: 'https://site.example.test/health',
}

const context: DeploymentContext = {
  jobId: 'job-1',
  publicationId: 'pub-1',
  snapshotHash: 'hash-1',
  dispatchedAt: DISPATCHED_AT,
}

type Req = { method: string; path: string; url: URL; init: RequestInit }
type Responder = (req: Req) => Response | Promise<Response>

/** A stateful stand-in for Cloudflare. Routes match on method and path. */
function fakeCloudflare(respond: Responder) {
  const calls: Req[] = []
  const fetchFn: typeof fetch = async (input, init = {}) => {
    const url = new URL(String(input))
    const req: Req = {
      method: init.method ?? 'GET',
      path: url.pathname,
      url,
      init,
    }
    calls.push(req)
    return respond(req)
  }
  return { fetchFn, calls }
}

function envelope(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function ok(result: unknown) {
  return envelope(200, { success: true, errors: [], messages: [], result })
}

function fail(status: number, message: string) {
  return envelope(status, {
    success: false,
    errors: [{ code: 1000, message }],
    messages: [],
    result: null,
  })
}

function pagesDeployment(
  id: string,
  overrides: {
    trigger?: string
    branch?: string
    createdOn?: string
    latest?: { name: string; status: string }
    stages?: { name: string; status: string }[]
  } = {},
) {
  return {
    id,
    short_id: id.slice(0, 8),
    url: `https://${id}.areca-site.pages.dev`,
    environment: 'production',
    deployment_trigger: {
      type: overrides.trigger ?? 'ad_hoc',
      metadata: { branch: overrides.branch ?? 'main', commit_hash: 'c0ffee' },
    },
    latest_stage: overrides.latest ?? { name: 'build', status: 'active' },
    stages: overrides.stages ?? [{ name: 'build', status: 'active' }],
    created_on: overrides.createdOn ?? AFTER,
  }
}

function workerBuild(
  uuid: string,
  overrides: {
    status?: string
    outcome?: string | null
    trigger?: string
    source?: string
    branch?: string
    createdOn?: string
  } = {},
) {
  return {
    build_uuid: uuid,
    status: overrides.status ?? 'queued',
    build_outcome: overrides.outcome ?? null,
    created_on: overrides.createdOn ?? AFTER,
    trigger: { trigger_uuid: overrides.trigger ?? TRIGGER },
    build_trigger_metadata: {
      build_trigger_source: overrides.source ?? 'manual',
      branch: overrides.branch ?? 'main',
    },
  }
}

/**
 * A clock the adapter reads and sleeps on. A sleep records its length and
 * advances the clock at once, so retries and polls never wait in real time.
 */
function fakeClock(start: Date = DISPATCHED_AT) {
  let current = start.getTime()
  const sleeps: number[] = []
  return {
    now: () => new Date(current),
    sleep: async (ms: number) => {
      sleeps.push(ms)
      current += ms
    },
    sleeps,
  }
}

function adapterFor(respond: Responder, clock = fakeClock()) {
  const fake = fakeCloudflare(respond)
  const client = createCloudflareClient({
    apiToken: TOKEN,
    accountId: ACCOUNT_ID,
    fetch: fake.fetchFn,
  })
  const adapter = createCloudflareAdapter({
    client,
    accountId: ACCOUNT_ID,
    reconciliationTimeoutMs: 40,
    reconciliationPollMs: 5,
    now: clock.now,
    sleep: clock.sleep,
  })
  return { adapter, calls: fake.calls, sleeps: clock.sleeps }
}

const posts = (calls: Req[]) => calls.filter((call) => call.method === 'POST')

describe('deploy', () => {
  it('starts a Pages build from the branch and logs the dashboard link', async () => {
    const { adapter, calls } = adapterFor((req) => {
      if (
        req.method === 'POST' &&
        req.path === `${ACCOUNT}/pages/projects/${PROJECT}/deployments`
      ) {
        return ok(pagesDeployment('dep-1'))
      }
      if (req.method === 'PATCH') return ok({})
      return fail(404, 'unexpected')
    })
    const lines: string[] = []
    const result = await adapter.deploy(
      pagesTarget,
      (l) => lines.push(l),
      context,
    )
    expect(result).toEqual({ deploymentId: 'dep-1' })
    expect(posts(calls)).toHaveLength(1)
    expect((posts(calls)[0].init.body as FormData).get('branch')).toBe('main')
    expect(lines).toContain(
      `dashboard https://dash.cloudflare.com/${ACCOUNT_ID}/pages/view/${PROJECT}/dep-1`,
    )
  })

  it('queues a Workers build on the trigger and logs the Workers dashboard link', async () => {
    const { adapter, calls } = adapterFor((req) => {
      if (
        req.method === 'POST' &&
        req.path === `${ACCOUNT}/builds/triggers/${TRIGGER}/builds`
      ) {
        return ok(workerBuild('build-1', { status: 'queued' }))
      }
      if (req.method === 'PATCH') return ok({})
      return fail(404, 'unexpected')
    })
    const lines: string[] = []
    const result = await adapter.deploy(
      workersTarget,
      (l) => lines.push(l),
      context,
    )
    expect(result).toEqual({ deploymentId: 'build-1' })
    expect(JSON.parse(String(posts(calls)[0].init.body))).toEqual({
      branch: 'main',
    })
    expect(lines).toContain(
      `dashboard https://dash.cloudflare.com/${ACCOUNT_ID}/workers/services/view/areca-worker/production/builds/build-1`,
    )
  })

  it.each([
    ['a 503', () => fail(503, 'upstream unavailable')],
    [
      'a network error',
      () => {
        throw Object.assign(new TypeError('fetch failed'), {
          cause: { code: 'ECONNRESET' },
        })
      },
    ],
  ])(
    'sends the deploy POST once when it fails with %s',
    async (_name, failure) => {
      const { adapter, calls } = adapterFor((req) => {
        if (req.method === 'POST') return failure()
        if (req.method === 'PATCH') return ok({})
        return ok([])
      })
      await expect(
        adapter.deploy(workersTarget, () => {}, context),
      ).rejects.toBeInstanceOf(DeploymentUncertainError)
      expect(posts(calls)).toHaveLength(1)
    },
  )

  it('refuses without retry when Cloudflare rejects the POST', async () => {
    const { adapter, calls } = adapterFor((req) =>
      req.method === 'PATCH' ? ok({}) : fail(404, 'Trigger not found'),
    )
    await expect(
      adapter.deploy(workersTarget, () => {}, context),
    ).rejects.toBeInstanceOf(DeploymentNotDispatchedError)
    expect(posts(calls)).toHaveLength(1)
    expect(calls.filter((call) => call.method === 'GET')).toHaveLength(0)
  })

  it('reconciles a POST whose response was lost instead of sending it again', async () => {
    let listed = 0
    const { adapter, calls } = adapterFor((req) => {
      if (req.method === 'POST') return fail(503, 'upstream unavailable')
      if (req.method === 'PATCH') return ok({})
      listed += 1
      return ok([workerBuild('build-9', { createdOn: AFTER })])
    })
    const lines: string[] = []
    const result = await adapter.deploy(
      workersTarget,
      (l) => lines.push(l),
      context,
    )
    expect(result).toEqual({ deploymentId: 'build-9' })
    expect(posts(calls)).toHaveLength(1)
    expect(listed).toBeGreaterThan(0)
    expect(lines).toContain(
      'Deploy response uncertain; reconciling the same dispatch before proceeding',
    )
  })

  it('stays uncertain when a lost POST has no matching upstream build', async () => {
    const { adapter, calls } = adapterFor((req) =>
      req.method === 'POST'
        ? fail(500, 'boom')
        : ok(req.method === 'PATCH' ? {} : []),
    )
    await expect(
      adapter.deploy(workersTarget, () => {}, context),
    ).rejects.toBeInstanceOf(DeploymentUncertainError)
    expect(posts(calls)).toHaveLength(1)
  })

  it('does not guess when several upstream builds could be ours', async () => {
    const { adapter } = adapterFor((req) =>
      req.method === 'POST'
        ? fail(500, 'boom')
        : ok(
            req.method === 'PATCH'
              ? {}
              : [workerBuild('build-a'), workerBuild('build-b')],
          ),
    )
    await expect(
      adapter.deploy(workersTarget, () => {}, context),
    ).rejects.toThrow(/Multiple upstream builds/)
  })
})

describe('ARECA_SNAPSHOT_ID build variable', () => {
  const VARIABLE_PATH = {
    pages: `${ACCOUNT}/pages/projects/${PROJECT}`,
    workers: `${ACCOUNT}/builds/triggers/${TRIGGER}/environment_variables`,
  } as const
  const DISPATCH_PATH = {
    pages: `${ACCOUNT}/pages/projects/${PROJECT}/deployments`,
    workers: `${ACCOUNT}/builds/triggers/${TRIGGER}/builds`,
  } as const
  const dispatchResult = {
    pages: () => ok(pagesDeployment('dep-1')),
    workers: () => ok(workerBuild('build-1', { status: 'queued' })),
  } as const
  const targets = {
    pages: pagesTarget,
    workers: workersTarget,
  } as const
  const expectedBody = {
    pages: {
      deployment_configs: {
        production: {
          env_vars: {
            ARECA_SNAPSHOT_ID: { type: 'plain_text', value: 'pub-1' },
          },
        },
      },
    },
    workers: {
      ARECA_SNAPSHOT_ID: { is_secret: false, value: 'pub-1' },
    },
  } as const

  /** Answers the write with `write` and the dispatch POST with the target's result. */
  function fakeFor(
    kind: 'pages' | 'workers',
    write: (attempt: number) => Response,
  ) {
    let writes = 0
    return adapterFor((req) => {
      if (req.method === 'PATCH' && req.path === VARIABLE_PATH[kind]) {
        writes += 1
        return write(writes)
      }
      if (req.method === 'POST' && req.path === DISPATCH_PATH[kind]) {
        return dispatchResult[kind]()
      }
      return fail(404, 'unexpected')
    })
  }

  it.each(['pages', 'workers'] as const)(
    'writes the publication ID before the dispatch POST (%s)',
    async (kind) => {
      const { adapter, calls } = fakeFor(kind, () => ok({}))
      const lines: string[] = []
      await adapter.deploy(targets[kind], (l) => lines.push(l), context)

      const order = calls.map((call) => `${call.method} ${call.path}`)
      const write = order.indexOf(`PATCH ${VARIABLE_PATH[kind]}`)
      const dispatch = order.indexOf(`POST ${DISPATCH_PATH[kind]}`)
      expect(write).toBeGreaterThanOrEqual(0)
      expect(dispatch).toBeGreaterThan(write)

      const body = JSON.parse(String(calls[write].init.body))
      expect(body).toEqual(expectedBody[kind])
      expect(new Headers(calls[write].init.headers).get('authorization')).toBe(
        `Bearer ${TOKEN}`,
      )
      expect(lines).toContain('build variable ARECA_SNAPSHOT_ID=pub-1')
    },
  )

  it.each(['pages', 'workers'] as const)(
    'does not dispatch when the write is refused (%s)',
    async (kind) => {
      const { adapter, calls } = fakeFor(kind, () =>
        fail(403, 'Authentication error'),
      )
      await expect(
        adapter.deploy(targets[kind], () => {}, context),
      ).rejects.toBeInstanceOf(DeploymentNotDispatchedError)
      expect(posts(calls)).toHaveLength(0)
      expect(calls.filter((call) => call.method === 'PATCH')).toHaveLength(1)
    },
  )

  it.each(['pages', 'workers'] as const)(
    'retries a write that fails once with 503, then dispatches (%s)',
    async (kind) => {
      const { adapter, calls } = fakeFor(kind, (attempt) =>
        attempt === 1 ? fail(503, 'busy') : ok({}),
      )
      await expect(
        adapter.deploy(targets[kind], () => {}, context),
      ).resolves.toEqual({
        deploymentId: kind === 'pages' ? 'dep-1' : 'build-1',
      })
      expect(calls.filter((call) => call.method === 'PATCH')).toHaveLength(2)
      expect(posts(calls)).toHaveLength(1)
    },
  )
})

describe('reconcile', () => {
  const pagesListing = (deployments: unknown[]) => (req: Req) =>
    req.method === 'GET' &&
    req.path === `${ACCOUNT}/pages/projects/${PROJECT}/deployments`
      ? ok(deployments)
      : fail(404, 'unexpected')

  it('accepts only the one ad_hoc production deployment on the branch after dispatch', async () => {
    const { adapter, calls } = adapterFor(
      pagesListing([
        pagesDeployment('ours', { createdOn: AFTER }),
        pagesDeployment('push', { trigger: 'github:push', createdOn: AFTER }),
        pagesDeployment('other-branch', { branch: 'dev', createdOn: AFTER }),
        pagesDeployment('older', { createdOn: BEFORE_WINDOW }),
      ]),
    )
    const found = await adapter.reconcile?.(pagesTarget, context, () => {})
    expect(found).toEqual({ deploymentId: 'ours' })
    expect(calls[0].url.searchParams.get('env')).toBe('production')
  })

  it('tolerates five seconds of clock skew but not more', async () => {
    const { adapter } = adapterFor(
      pagesListing([pagesDeployment('skewed', { createdOn: SKEW_OK })]),
    )
    expect(await adapter.reconcile?.(pagesTarget, context, () => {})).toEqual({
      deploymentId: 'skewed',
    })
    const { adapter: tooOld } = adapterFor(
      pagesListing([pagesDeployment('too-old', { createdOn: BEFORE_WINDOW })]),
    )
    expect(await tooOld.reconcile?.(pagesTarget, context, () => {})).toBeNull()
  })

  it('refuses several matching Pages deployments', async () => {
    const { adapter } = adapterFor(
      pagesListing([
        pagesDeployment('a', { createdOn: AFTER }),
        pagesDeployment('b', { createdOn: AFTER }),
      ]),
    )
    await expect(
      adapter.reconcile?.(pagesTarget, context, () => {}),
    ).rejects.toBeInstanceOf(DeploymentUncertainError)
  })

  it('returns null for zero Pages matches, which leaves the dispatch unknown', async () => {
    const { adapter } = adapterFor(pagesListing([]))
    expect(await adapter.reconcile?.(pagesTarget, context, () => {})).toBeNull()
  })

  it('ignores Worker builds from git pushes, other triggers, other branches and older builds', async () => {
    const { adapter } = adapterFor((req) =>
      req.path === `${ACCOUNT}/builds/workers/${SCRIPT_TAG}/builds`
        ? ok([
            workerBuild('push', { source: 'push_event', createdOn: AFTER }),
            workerBuild('other-trigger', {
              trigger: '99999999-2222-4333-8444-555555555555',
              createdOn: AFTER,
            }),
            workerBuild('other-branch', { branch: 'dev', createdOn: AFTER }),
            workerBuild('older', { createdOn: BEFORE_WINDOW }),
            workerBuild('ours', { createdOn: AFTER }),
          ])
        : fail(404, 'unexpected'),
    )
    expect(await adapter.reconcile?.(workersTarget, context, () => {})).toEqual(
      {
        deploymentId: 'ours',
      },
    )
  })

  it('refuses several matching Worker builds and returns null for none', async () => {
    const twice = adapterFor(() =>
      ok([workerBuild('a'), workerBuild('b')]),
    ).adapter
    await expect(
      twice.reconcile?.(workersTarget, context, () => {}),
    ).rejects.toBeInstanceOf(DeploymentUncertainError)
    const none = adapterFor(() => ok([])).adapter
    expect(await none.reconcile?.(workersTarget, context, () => {})).toBeNull()
  })

  it('never lists upstream without a dispatch time, and stays unknown', async () => {
    const { adapter, calls } = adapterFor(() => ok([workerBuild('ours')]))
    const found = await adapter.reconcile?.(
      workersTarget,
      { jobId: 'job-1', publicationId: 'pub-1', snapshotHash: 'h' },
      () => {},
    )
    expect(found).toBeNull()
    expect(calls).toHaveLength(0)
  })
})

describe('waitForCompletion', () => {
  const poll = { timeoutMs: 400, pollMs: 5 }

  it('is done when the Pages deploy stage succeeds', async () => {
    let reads = 0
    const { adapter } = adapterFor(() => {
      reads += 1
      return ok(
        reads < 2
          ? pagesDeployment('dep-1', {
              latest: { name: 'build', status: 'active' },
            })
          : pagesDeployment('dep-1', {
              latest: { name: 'deploy', status: 'success' },
              stages: [
                { name: 'build', status: 'success' },
                { name: 'deploy', status: 'success' },
              ],
            }),
      )
    })
    const lines: string[] = []
    expect(
      await adapter.waitForCompletion(pagesTarget, 'dep-1', poll, (l) =>
        lines.push(l),
      ),
    ).toBe('done')
    expect(lines).toContain('deployment=dep-1 status=build:active')
  })

  it('is error and logs the tail when a Pages stage fails', async () => {
    const logLines = Array.from({ length: 3 }, (_, i) => `pages line ${i + 1}`)
    const { adapter } = adapterFor((req) => {
      if (req.path.endsWith('/history/logs')) {
        return ok({ data: logLines.map((line) => ({ ts: 1, line })) })
      }
      return ok(
        pagesDeployment('dep-1', {
          latest: { name: 'build', status: 'failure' },
          stages: [{ name: 'build', status: 'failure' }],
        }),
      )
    })
    const lines: string[] = []
    expect(
      await adapter.waitForCompletion(pagesTarget, 'dep-1', poll, (l) =>
        lines.push(l),
      ),
    ).toBe('error')
    expect(lines).toEqual(
      expect.arrayContaining([
        'cloudflare: pages line 1',
        'cloudflare: pages line 3',
      ]),
    )
  })

  it('is error when a Pages stage is canceled', async () => {
    const { adapter } = adapterFor((req) =>
      req.path.endsWith('/history/logs')
        ? ok({ data: [] })
        : ok(
            pagesDeployment('dep-1', {
              latest: { name: 'deploy', status: 'canceled' },
              stages: [{ name: 'deploy', status: 'canceled' }],
            }),
          ),
    )
    expect(
      await adapter.waitForCompletion(pagesTarget, 'dep-1', poll, () => {}),
    ).toBe('error')
  })

  it('is done only for a stopped build with outcome success', async () => {
    const { adapter } = adapterFor(() =>
      ok(workerBuild('build-1', { status: 'stopped', outcome: 'success' })),
    )
    expect(
      await adapter.waitForCompletion(workersTarget, 'build-1', poll, () => {}),
    ).toBe('done')
  })

  it.each(['fail', 'cancelled', 'terminated', 'skipped'])(
    'is error for a stopped build with outcome %s',
    async (outcome) => {
      const { adapter } = adapterFor((req) =>
        req.path.endsWith('/logs')
          ? ok({ cursor: null, truncated: false, lines: [], events: [] })
          : ok(workerBuild('build-1', { status: 'stopped', outcome })),
      )
      expect(
        await adapter.waitForCompletion(
          workersTarget,
          'build-1',
          poll,
          () => {},
        ),
      ).toBe('error')
    },
  )

  it('returns timeout while the build keeps running', async () => {
    const { adapter } = adapterFor(() =>
      ok(workerBuild('build-1', { status: 'running' })),
    )
    expect(
      await adapter.waitForCompletion(
        workersTarget,
        'build-1',
        { timeoutMs: 40, pollMs: 5 },
        () => {},
      ),
    ).toBe('timeout')
  })

  it('keeps polling through a transient read failure', async () => {
    let reads = 0
    const { adapter } = adapterFor(() => {
      reads += 1
      if (reads === 1) return fail(503, 'busy')
      return ok(
        workerBuild('build-1', { status: 'stopped', outcome: 'success' }),
      )
    })
    expect(
      await adapter.waitForCompletion(workersTarget, 'build-1', poll, () => {}),
    ).toBe('done')
    expect(reads).toBe(2)
  })

  describe('status polls survive transient failures', () => {
    const networkError = () => {
      throw Object.assign(new TypeError('fetch failed'), {
        cause: { code: 'ENOTFOUND' },
      })
    }
    const transient: [string, () => Response | never, string][] = [
      ['a 429 error envelope', () => fail(429, 'rate limited'), 'HTTP 429'],
      ['a DNS failure', networkError, 'no response'],
      ['a 503', () => fail(503, 'busy'), 'HTTP 503'],
    ]

    it.each(transient)(
      'succeeds after two failed polls with %s',
      async (_name, failure, reason) => {
        let reads = 0
        const logs: string[] = []
        const { adapter, sleeps } = adapterFor(() => {
          reads += 1
          if (reads <= 2) return failure()
          return ok(
            workerBuild('build-1', { status: 'stopped', outcome: 'success' }),
          )
        })
        expect(
          await adapter.waitForCompletion(
            workersTarget,
            'build-1',
            { timeoutMs: 60_000, pollMs: 5 },
            (line) => logs.push(line),
          ),
        ).toBe('done')
        expect(reads).toBe(3)
        expect(sleeps).toEqual([500, 1_000])
        expect(logs.filter((line) => line.startsWith('poll failed'))).toEqual([
          `poll failed (${reason}); retrying in 500ms`,
          `poll failed (${reason}); retrying in 1s`,
        ])
      },
    )

    it('logs the HTTP status of a failed poll', async () => {
      let reads = 0
      const logs: string[] = []
      const { adapter } = adapterFor(() => {
        reads += 1
        if (reads === 1) return fail(429, 'slow down')
        return ok(
          workerBuild('build-1', { status: 'stopped', outcome: 'success' }),
        )
      })
      await adapter.waitForCompletion(
        workersTarget,
        'build-1',
        { timeoutMs: 60_000, pollMs: 5 },
        (line) => logs.push(line),
      )
      expect(logs).toContain('poll failed (HTTP 429); retrying in 500ms')
    })

    it('backs off 0.5, 1, 2, 4, 8, 15 seconds, then throws', async () => {
      let reads = 0
      const { adapter, sleeps } = adapterFor(() => {
        reads += 1
        return fail(503, 'busy')
      })
      await expect(
        adapter.waitForCompletion(
          workersTarget,
          'build-1',
          { timeoutMs: 60_000, pollMs: 5 },
          () => {},
        ),
      ).rejects.toThrow('failed (HTTP 503)')
      expect(reads).toBe(7)
      expect(sleeps).toEqual([500, 1_000, 2_000, 4_000, 8_000, 15_000])
    })

    it('caps the retry waits to the wait deadline', async () => {
      let reads = 0
      const { adapter, sleeps } = adapterFor(() => {
        reads += 1
        return fail(503, 'busy')
      })
      await expect(
        adapter.waitForCompletion(
          workersTarget,
          'build-1',
          { timeoutMs: 10_000, pollMs: 5 },
          () => {},
        ),
      ).rejects.toThrow('failed (HTTP 503)')
      expect(reads).toBe(6)
      expect(sleeps).toEqual([500, 1_000, 2_000, 4_000, 2_500])
    })

    it('throws at once on a 403 during polling', async () => {
      let reads = 0
      const { adapter, sleeps } = adapterFor(() => {
        reads += 1
        return fail(403, 'forbidden')
      })
      await expect(
        adapter.waitForCompletion(workersTarget, 'build-1', poll, () => {}),
      ).rejects.toThrow('failed (HTTP 403)')
      expect(reads).toBe(1)
      expect(sleeps).toEqual([])
    })
  })
})

describe('failure log tail', () => {
  it('logs the last 100 lines of a multi-page build log, oldest first', async () => {
    const { adapter, calls } = adapterFor((req) => {
      if (req.path === `${ACCOUNT}/builds/builds/build-1`) {
        return ok(
          workerBuild('build-1', { status: 'stopped', outcome: 'fail' }),
        )
      }
      if (req.path === `${ACCOUNT}/builds/builds/build-1/logs`) {
        const cursor = req.url.searchParams.get('cursor')
        if (cursor === null) {
          return ok({
            cursor: 'page-2',
            truncated: true,
            lines: Array.from({ length: 60 }, (_, i) => [i, `line ${i + 1}`]),
          })
        }
        return ok({
          cursor: 'page-3',
          truncated: false,
          lines: Array.from({ length: 90 }, (_, i) => [i, `line ${i + 61}`]),
        })
      }
      return fail(404, 'unexpected')
    })
    const lines: string[] = []
    expect(
      await adapter.waitForCompletion(
        workersTarget,
        'build-1',
        { timeoutMs: 200, pollMs: 5 },
        (l) => lines.push(l),
      ),
    ).toBe('error')
    const tail = lines.filter((line) => line.startsWith('cloudflare: '))
    expect(tail).toHaveLength(100)
    expect(tail[0]).toBe('cloudflare: line 51')
    expect(tail.at(-1)).toBe('cloudflare: line 150')
    expect(calls.map((call) => call.url.searchParams.get('cursor'))).toContain(
      'page-2',
    )
  })

  it('tolerates a failed log fetch and still reports the error', async () => {
    const { adapter } = adapterFor((req) =>
      req.path.endsWith('/logs')
        ? fail(500, 'logs down')
        : ok(workerBuild('build-1', { status: 'stopped', outcome: 'fail' })),
    )
    const lines: string[] = []
    await expect(
      adapter.waitForCompletion(
        workersTarget,
        'build-1',
        { timeoutMs: 200, pollMs: 5 },
        (l) => lines.push(l),
      ),
    ).resolves.toBe('error')
    expect(lines).toContain('cloudflare: build logs could not be fetched')
  })
})

describe('healthCheck', () => {
  it('reports a health URL that answers 200 as healthy', async () => {
    const adapter = createCloudflareAdapter({
      client: createCloudflareClient({
        apiToken: TOKEN,
        accountId: ACCOUNT_ID,
      }),
      accountId: ACCOUNT_ID,
      resolveHost: async () => ['93.184.216.34'],
      fetch: async () => new Response('ok', { status: 200 }),
    })
    expect(
      await adapter.healthCheck('https://site.example.test/health', {
        timeoutMs: 200,
        intervalMs: 10,
      }),
    ).toBe(true)
  })

  it('refuses a health URL that resolves to a private address', async () => {
    const adapter = createCloudflareAdapter({
      client: createCloudflareClient({
        apiToken: TOKEN,
        accountId: ACCOUNT_ID,
      }),
      accountId: ACCOUNT_ID,
      resolveHost: async () => ['10.0.0.5'],
      fetch: vi.fn(async () => new Response('ok', { status: 200 })),
    })
    expect(
      await adapter.healthCheck('https://site.example.test/health', {
        timeoutMs: 40,
        intervalMs: 10,
      }),
    ).toBe(false)
  })
})

describe('target guard', () => {
  it('rejects a Dokploy target handed to the Cloudflare adapter', async () => {
    const { adapter } = adapterFor(() => ok({}))
    await expect(
      adapter.deploy(
        {
          provider: 'dokploy',
          applicationId: 'app',
          healthCheckUrl: 'https://x.test',
        },
        () => {},
        context,
      ),
    ).rejects.toThrow(/non-Cloudflare target/)
  })
})
