import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { describe, expect, it } from 'vitest'
import {
  createDokployAdapter,
  listDokployApplications,
  pinnedRequest,
} from './dokploy'
import { DeploymentUncertainError } from './types'
import type { DeploymentTarget } from './types'

const context = {
  jobId: 'job-1',
  publicationId: 'pub-1',
  snapshotHash: 'hash-1',
}
const identity = {
  title: 'areca:job-1',
  description: 'publication=pub-1 snapshot=hash-1',
}

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
  reconciliationTimeoutMs: 0,
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
    const error = await adapter
      .deploy(target, () => {}, context)
      .catch((cause) => cause)
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toContain('failed: 500')
    expect((error as Error).message).not.toContain('must-not-leak')
  })

  it('POSTs immutable identity then reads only its exact deploymentId', async () => {
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
              {
                deploymentId: 'new',
                createdAt: '2026-01-02T00:00:00.000Z',
                ...identity,
              },
              {
                deploymentId: 'newer-unrelated',
                createdAt: '2026-01-03T00:00:00.000Z',
              },
            ],
          })
        }
        return new Response('not found', { status: 404 })
      }),
    })

    const logs: string[] = []
    const result = await adapter.deploy(
      target,
      (line) => logs.push(line),
      context,
    )

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
      ...identity,
    })
    const saved = JSON.parse(String(calls[1]?.init?.body)) as {
      buildArgs: string
      buildSecrets: string
    }
    expect(saved.buildArgs).toContain('ARECA_SNAPSHOT_ID=pub-1')
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
              ...identity,
              createdAt: '2026-01-02T00:00:00.000Z',
            },
          ],
        })
      }),
    })
    const result = await adapter.deploy(target, () => {}, context)
    expect(result.deploymentId).toBe('dep-empty')
  })

  it('quarantines missing deployment identity instead of fabricating an ID', async () => {
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
    await expect(adapter.deploy(target, () => {}, context)).rejects.toThrow(
      /acceptance unknown/,
    )
  })

  it('polls the exact deployment until done', async () => {
    let polls = 0
    const adapter = createDokployAdapter({
      baseUrl: 'http://dokploy.test',
      apiKey: 'k',
      ...localTestOptions,
      fetch: fakeFetch(() => {
        polls += 1
        const status = polls < 3 ? 'running' : 'done'
        return json({
          applicationStatus: 'error',
          deployments: [{ deploymentId: 'dep-1', status }],
        })
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
    expect(logs).toContain('deployment=dep-1 status=running')
    expect(logs).toContain('deployment=dep-1 status=done')
  })

  it('returns error only when the exact deployment is error', async () => {
    const adapter = createDokployAdapter({
      baseUrl: 'http://dokploy.test',
      apiKey: 'k',
      ...localTestOptions,
      fetch: fakeFetch(() =>
        json({
          applicationStatus: 'done',
          deployments: [{ deploymentId: 'dep-1', status: 'error' }],
        }),
      ),
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

  it('reconciles a lost accepted response without repeating deploy POST', async () => {
    let posts = 0
    const adapter = createDokployAdapter({
      baseUrl: 'https://dokploy.test',
      apiKey: 'private-database-key',
      reconciliationTimeoutMs: 0,
      fetch: fakeFetch((url) => {
        if (url.endsWith('/api/application.deploy')) {
          posts++
          throw new Error('private-database-key lost response')
        }
        if (url.endsWith('/api/application.saveEnvironment')) return json(true)
        return json({
          deployments: posts ? [{ deploymentId: 'accepted', ...identity }] : [],
        })
      }),
    })
    expect(await adapter.deploy(target, () => {}, context)).toEqual({
      deploymentId: 'accepted',
    })
    expect(posts).toBe(1)
  })

  it('retries transient preparation failures within a bounded budget', async () => {
    let reads = 0
    let saves = 0
    let posts = 0
    const adapter = createDokployAdapter({
      baseUrl: 'https://dokploy.test',
      apiKey: 'key',
      reconciliationTimeoutMs: 0,
      fetch: fakeFetch((url) => {
        if (url.endsWith('/api/application.deploy')) {
          posts++
          return json(true)
        }
        if (url.endsWith('/api/application.saveEnvironment')) {
          saves++
          return json(true, saves < 3 ? 503 : 200)
        }
        reads++
        if (reads < 3) return json({}, 503)
        return json({
          deployments: [{ deploymentId: 'accepted', ...identity }],
        })
      }),
    })
    await expect(adapter.deploy(target, () => {}, context)).resolves.toEqual({
      deploymentId: 'accepted',
    })
    expect(reads).toBe(4)
    expect(saves).toBe(3)
    expect(posts).toBe(1)
  })

  it('stops after three transient preparation attempts without dispatching', async () => {
    let requests = 0
    const adapter = createDokployAdapter({
      baseUrl: 'https://dokploy.test',
      apiKey: 'key',
      fetch: fakeFetch(() => {
        requests++
        return json({}, 503)
      }),
    })
    await expect(adapter.deploy(target, () => {}, context)).rejects.toThrow(
      'failed: 503',
    )
    expect(requests).toBe(3)
  })

  it('scrubs organization credentials from fetch and malformed JSON errors', async () => {
    const secret = 'decrypted-organization-key'
    for (const handler of [
      () => {
        throw new Error(`network error ${secret}`)
      },
      () => new Response(`not JSON ${secret}`, { status: 200 }),
    ]) {
      const adapter = createDokployAdapter({
        baseUrl: 'https://dokploy.test',
        apiKey: secret,
        fetch: fakeFetch(handler),
      })
      const error = await adapter
        .deploy(target, () => {}, context)
        .catch((cause) => cause)
      expect(error).toBeInstanceOf(Error)
      expect(error.message).not.toContain(secret)
    }
  })

  it('does not retry permanent auth failure or send a deployment', async () => {
    let requests = 0
    const adapter = createDokployAdapter({
      baseUrl: 'https://dokploy.test',
      apiKey: 'key',
      fetch: fakeFetch(() => {
        requests++
        return json({}, 401)
      }),
    })
    await expect(adapter.deploy(target, () => {}, context)).rejects.toThrow(
      'failed: 401',
    )
    expect(requests).toBe(1)
  })

  it('does not retry a deploy 5xx and leaves unmatched acceptance uncertain', async () => {
    let posts = 0
    const adapter = createDokployAdapter({
      baseUrl: 'https://dokploy.test',
      apiKey: 'key',
      reconciliationTimeoutMs: 0,
      fetch: fakeFetch((url) => {
        if (url.endsWith('/api/application.deploy')) {
          posts++
          return json({}, 500)
        }
        if (url.endsWith('/api/application.saveEnvironment')) return json(true)
        return json({
          deployments: [
            { deploymentId: 'someone-else', title: 'Manual deployment' },
          ],
        })
      }),
    })
    await expect(adapter.deploy(target, () => {}, context)).rejects.toThrow(
      /acceptance unknown/,
    )
    expect(posts).toBe(1)
  })

  it('does not use application status when the exact deployment is missing', async () => {
    const adapter = createDokployAdapter({
      baseUrl: 'https://dokploy.test',
      apiKey: 'key',
      fetch: fakeFetch(() =>
        json({
          applicationStatus: 'done',
          deployments: [{ deploymentId: 'another', status: 'done' }],
        }),
      ),
    })
    expect(
      await adapter.waitForCompletion(
        target,
        'missing',
        { timeoutMs: 20, pollMs: 5 },
        () => {},
      ),
    ).toBe('timeout')
  })

  it('refuses multiple matching deployment identities', async () => {
    const adapter = createDokployAdapter({
      baseUrl: 'https://dokploy.test',
      apiKey: 'key',
      fetch: fakeFetch(() =>
        json({
          deployments: [
            { deploymentId: 'one', ...identity },
            { deploymentId: 'two', ...identity },
          ],
        }),
      ),
    })
    await expect(adapter.reconcile!(target, context, () => {})).rejects.toThrow(
      /Multiple/,
    )
  })

  describe('when the provider ignores the dispatch title (git-sourced apps)', () => {
    const dispatchedAt = new Date('2026-01-02T00:00:00.000Z')
    const dispatchContext = { ...context, dispatchedAt }
    const gitCommitTitle = {
      title: 'Merge pull request #13 from ekozf/release/site-sdk',
      description: 'Commit: 8917f62a',
    }
    const previous = {
      deploymentId: 'previous',
      title: 'Merge pull request #12',
      description: 'Commit: 6aa1b27',
      createdAt: '2026-01-01T00:00:00.000Z',
    }

    function adapterWith(deployments: unknown[], timing = {}) {
      return createDokployAdapter({
        baseUrl: 'https://dokploy.test',
        apiKey: 'key',
        reconciliationTimeoutMs: 20,
        reconciliationPollMs: 5,
        ...timing,
        fetch: fakeFetch(() => json({ deployments })),
      })
    }

    it('matches the one deployment created after dispatch on deploy()', async () => {
      let posts = 0
      const logs: string[] = []
      const adapter = createDokployAdapter({
        baseUrl: 'http://dokploy.test',
        apiKey: 'k',
        ...localTestOptions,
        fetch: fakeFetch((url) => {
          if (url.endsWith('/api/application.deploy')) {
            posts++
            return json(true)
          }
          if (url.endsWith('/api/application.saveEnvironment')) {
            return json(true)
          }
          return json({
            deployments: [
              previous,
              {
                deploymentId: 'accepted',
                ...gitCommitTitle,
                status: 'running',
                createdAt: '2026-01-02T00:00:02.000Z',
              },
            ],
          })
        }),
      })
      const result = await adapter.deploy(
        target,
        (line) => logs.push(line),
        dispatchContext,
      )
      expect(result).toEqual({ deploymentId: 'accepted' })
      expect(posts).toBe(1)
      expect(logs).toContain(
        'deployment=accepted matched as the only deployment created after dispatch',
      )
    })

    it('refuses when two deployments were created after dispatch', async () => {
      const adapter = adapterWith([
        previous,
        {
          deploymentId: 'one',
          ...gitCommitTitle,
          createdAt: '2026-01-02T00:00:02.000Z',
        },
        {
          deploymentId: 'two',
          title: 'Manual redeploy',
          createdAt: '2026-01-02T00:00:03.000Z',
        },
      ])
      const error = await adapter.reconcile!(
        target,
        dispatchContext,
        () => {},
      ).catch((cause) => cause)
      expect(error).toBeInstanceOf(DeploymentUncertainError)
      expect((error as Error).message).toMatch(/Multiple upstream deployments/)
    })

    it('stays unknown when only older deployments exist', async () => {
      const adapter = adapterWith([previous])
      expect(
        await adapter.reconcile!(target, dispatchContext, () => {}),
      ).toBeNull()
    })

    it('does not take a new deployment that carries another job areca title', async () => {
      const adapter = adapterWith([
        previous,
        {
          deploymentId: 'other-job',
          title: 'areca:job-2',
          description: 'publication=pub-2 snapshot=hash-2',
          createdAt: '2026-01-02T00:00:02.000Z',
        },
      ])
      expect(
        await adapter.reconcile!(target, dispatchContext, () => {}),
      ).toBeNull()
    })

    it('prefers the exact dispatch identity over a newer unrelated deployment', async () => {
      const logs: string[] = []
      const adapter = adapterWith([
        {
          deploymentId: 'exact',
          ...identity,
          createdAt: '2026-01-02T00:00:01.000Z',
        },
        {
          deploymentId: 'newer',
          ...gitCommitTitle,
          createdAt: '2026-01-02T00:00:05.000Z',
        },
      ])
      expect(
        await adapter.reconcile!(target, dispatchContext, (line) =>
          logs.push(line),
        ),
      ).toEqual({ deploymentId: 'exact' })
      expect(logs).toContain('deployment=exact matched by dispatch title')
    })

    it('ignores the fallback without a dispatch time or createdAt', async () => {
      const adapter = adapterWith([
        { deploymentId: 'no-date', ...gitCommitTitle },
      ])
      expect(
        await adapter.reconcile!(target, dispatchContext, () => {}),
      ).toBeNull()
      expect(await adapter.reconcile!(target, context, () => {})).toBeNull()
    })
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

  it('connects through the pinned addresses when Node asks for all of them', async () => {
    // Regression: Node 22+ calls `lookup` with { all: true }. Answering with a
    // single address made every real health check fail with
    // ERR_INVALID_IP_ADDRESS, while fetch-mocked tests kept passing.
    const server = createServer((_req, res) => {
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ ok: true, publicationId: 'pub-1' }))
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo
    try {
      const response = await pinnedRequest(
        new URL(`http://pinned.test:${port}/api/health`),
        ['127.0.0.1'],
        2_000,
      )
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({
        ok: true,
        publicationId: 'pub-1',
      })
    } finally {
      await new Promise((resolve) => server.close(resolve))
    }
  })
})
