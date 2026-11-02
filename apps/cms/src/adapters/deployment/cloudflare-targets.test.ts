import { describe, expect, it } from 'vitest'

import { CloudflareApiError, createCloudflareClient } from './cloudflare-api'
import {
  autoPickTrigger,
  collectCloudflareDeployTargets,
  isPreviewDeployCommand,
  mapWithConcurrency,
  suggestedHealthUrl,
  usableBuildTriggers,
} from './cloudflare-targets'
import type { CloudflareBuildTrigger } from './cloudflare-targets'

const ACCOUNT_ID = '0123456789abcdef0123456789abcdef'
const BASE_PATH = '/client/v4'
const NOW = new Date('2026-11-02T10:00:00.000Z')
const DEPLOY = 'npx wrangler deploy'
const PREVIEW = 'npx wrangler versions upload'

type Handler = (
  url: URL,
  match: RegExpExecArray,
) => Response | Promise<Response>

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function ok(result: unknown) {
  return json(200, { success: true, errors: [], messages: [], result })
}

/**
 * A fake Cloudflare that answers by path pattern. Unknown paths answer 404,
 * so a call the test did not expect fails the test instead of passing silently.
 */
function fakeCloudflare(handlers: [RegExp, Handler][]) {
  const calls: string[] = []
  const fetchFn: typeof fetch = async (input) => {
    const url = new URL(String(input))
    calls.push(url.pathname + url.search)
    const path = url.pathname.slice(BASE_PATH.length)
    for (const [pattern, handler] of handlers) {
      const match = pattern.exec(path)
      if (match) return handler(url, match)
    }
    return json(404, {
      success: false,
      errors: [{ code: 1, message: `no route for ${path}` }],
      messages: [],
      result: null,
    })
  }
  return { fetchFn, calls }
}

const accountRoute = (suffix: string) =>
  new RegExp(`^/accounts/${ACCOUNT_ID}${suffix}$`)

function clientFor(fetchFn: typeof fetch) {
  return createCloudflareClient({
    apiToken: 'cfut_test_token',
    accountId: ACCOUNT_ID,
    fetch: fetchFn,
  })
}

function trigger(
  uuid: string,
  branches: string[],
  deployCommand: string | null = DEPLOY,
  extra: Record<string, unknown> = {},
) {
  return {
    trigger_uuid: uuid,
    trigger_name: `name-${uuid}`,
    branch_includes: branches,
    deploy_command: deployCommand,
    deleted_on: null,
    ...extra,
  }
}

describe('collectCloudflareDeployTargets: Pages', () => {
  it('groups by kind, disables direct uploads, and picks the domain and suggestion', async () => {
    const { fetchFn } = fakeCloudflare([
      [
        accountRoute('/pages/projects'),
        () =>
          ok([
            {
              name: 'marketing-site',
              subdomain: 'marketing-site.pages.dev',
              domains: ['marketing.example.com', 'www.example.com'],
              production_branch: 'main',
              source: { type: 'github', config: { production_branch: 'main' } },
            },
            {
              name: 'legacy-upload',
              subdomain: 'legacy-upload.pages.dev',
              domains: [],
              production_branch: 'main',
              source: null,
            },
            {
              name: 'another-site',
              subdomain: 'another-site.pages.dev',
              domains: [],
              source: {
                type: 'gitlab',
                config: { production_branch: 'release' },
              },
            },
          ]),
      ],
      [accountRoute('/workers/scripts'), () => ok([])],
    ])

    const result = await collectCloudflareDeployTargets(clientFor(fetchFn), {
      now: NOW,
    })

    expect(result.fetchedAt).toBe(NOW.toISOString())
    expect(result.workers).toEqual([])
    expect(result.pages.map((target) => target.name)).toEqual([
      'another-site',
      'legacy-upload',
      'marketing-site',
    ])
    const [another, legacy, marketing] = result.pages
    expect(another).toMatchObject({
      kind: 'pages',
      scriptTag: null,
      productionBranch: 'release',
      primaryDomain: 'another-site.pages.dev',
      suggestedHealthUrl: 'https://another-site.pages.dev/api/health',
      buildable: true,
      disabledReason: null,
      triggers: [],
      autoTriggerUuid: null,
    })
    expect(legacy).toMatchObject({
      buildable: false,
      disabledReason: 'no_git',
      primaryDomain: 'legacy-upload.pages.dev',
    })
    expect(marketing).toMatchObject({
      productionBranch: 'main',
      primaryDomain: 'marketing.example.com',
      suggestedHealthUrl: 'https://marketing.example.com/api/health',
      buildable: true,
      disabledReason: null,
    })
  })

  it('reports no domain and no suggestion for a project with neither', async () => {
    const { fetchFn } = fakeCloudflare([
      [
        accountRoute('/pages/projects'),
        () =>
          ok([
            {
              name: 'bare',
              subdomain: '',
              domains: [],
              production_branch: 'main',
              source: { type: 'github' },
            },
          ]),
      ],
      [accountRoute('/workers/scripts'), () => ok([])],
    ])

    const result = await collectCloudflareDeployTargets(clientFor(fetchFn), {
      now: NOW,
    })
    expect(result.pages[0]).toMatchObject({
      primaryDomain: null,
      suggestedHealthUrl: null,
    })
  })
})

describe('collectCloudflareDeployTargets: Workers', () => {
  function workersFake(
    triggers: Record<string, unknown[]>,
    extra: {
      accountSubdomain?: string | null
      enabled?: Record<string, boolean>
      domains?: Record<string, string[]>
    } = {},
  ) {
    const scripts = Object.keys(triggers).map((name) => ({
      id: name,
      tag: `tag-${name}`,
    }))
    return fakeCloudflare([
      [accountRoute('/pages/projects'), () => ok([])],
      [accountRoute('/workers/scripts'), () => ok(scripts)],
      [
        accountRoute('/workers/subdomain'),
        () =>
          ok({
            subdomain:
              extra.accountSubdomain === undefined
                ? 'acct'
                : extra.accountSubdomain,
          }),
      ],
      [
        accountRoute('/workers/scripts/([^/]+)/subdomain'),
        (_url, match) =>
          ok({
            enabled: extra.enabled?.[match[1]] ?? false,
            previews_enabled: false,
          }),
      ],
      [
        accountRoute('/workers/domains'),
        (url) =>
          ok(
            (extra.domains?.[url.searchParams.get('service') ?? ''] ?? []).map(
              (hostname) => ({ hostname }),
            ),
          ),
      ],
      [
        accountRoute('/builds/workers/([^/]+)/triggers'),
        (_url, match) => {
          const name = match[1].replace(/^tag-/, '')
          return ok(triggers[name] ?? [])
        },
      ],
    ])
  }

  it('lists a Worker without Workers Builds as disabled', async () => {
    const { fetchFn } = workersFake({ 'plain-worker': [] })
    const result = await collectCloudflareDeployTargets(clientFor(fetchFn), {
      now: NOW,
    })
    expect(result.workers[0]).toMatchObject({
      kind: 'workers',
      name: 'plain-worker',
      scriptTag: 'tag-plain-worker',
      buildable: false,
      disabledReason: 'no_builds',
      productionBranch: null,
      triggers: [],
      autoTriggerUuid: null,
      primaryDomain: null,
    })
  })

  it('ignores the versions-upload preview trigger when a production trigger exists', async () => {
    const { fetchFn } = workersFake(
      {
        'shop-worker': [
          trigger('trigger-preview', ['main'], PREVIEW),
          trigger('trigger-prod', ['main'], DEPLOY),
        ],
      },
      { enabled: { 'shop-worker': true } },
    )
    const result = await collectCloudflareDeployTargets(clientFor(fetchFn), {
      now: NOW,
    })
    const shop = result.workers[0]
    expect(shop).toMatchObject({
      buildable: true,
      disabledReason: null,
      productionBranch: 'main',
      autoTriggerUuid: 'trigger-prod',
      primaryDomain: 'shop-worker.acct.workers.dev',
      suggestedHealthUrl: 'https://shop-worker.acct.workers.dev/api/health',
    })
    expect(shop.triggers).toEqual([
      {
        triggerUuid: 'trigger-preview',
        name: 'name-trigger-preview',
        branch: 'main',
        preview: true,
      },
      {
        triggerUuid: 'trigger-prod',
        name: 'name-trigger-prod',
        branch: 'main',
        preview: false,
      },
    ])
  })

  it('does not build a Worker whose only trigger is a preview', async () => {
    const { fetchFn } = workersFake({
      'preview-only': [trigger('trigger-only', ['main'], PREVIEW)],
    })
    const result = await collectCloudflareDeployTargets(clientFor(fetchFn), {
      now: NOW,
    })
    expect(result.workers[0]).toMatchObject({
      name: 'preview-only',
      buildable: false,
      disabledReason: 'no_production_trigger',
      productionBranch: null,
      autoTriggerUuid: null,
    })
    expect(result.workers[0].triggers).toEqual([
      {
        triggerUuid: 'trigger-only',
        name: 'name-trigger-only',
        branch: 'main',
        preview: true,
      },
    ])
  })

  it('picks the production trigger when one production and one preview trigger exist', async () => {
    const { fetchFn } = workersFake({
      'mixed-worker': [
        trigger('trigger-preview', ['main'], PREVIEW),
        trigger('trigger-prod', ['main'], DEPLOY),
      ],
    })
    const result = await collectCloudflareDeployTargets(clientFor(fetchFn), {
      now: NOW,
    })
    expect(result.workers[0]).toMatchObject({
      buildable: true,
      disabledReason: null,
      autoTriggerUuid: 'trigger-prod',
      productionBranch: 'main',
    })
  })

  it('leaves the trigger to the admin when two production triggers name the same branch', async () => {
    const { fetchFn } = workersFake({
      'twin-worker': [
        trigger('trigger-a', ['main'], DEPLOY),
        trigger('trigger-b', ['main'], DEPLOY),
      ],
    })
    const result = await collectCloudflareDeployTargets(clientFor(fetchFn), {
      now: NOW,
    })
    expect(result.workers[0]).toMatchObject({
      buildable: true,
      disabledReason: null,
      autoTriggerUuid: null,
      productionBranch: null,
    })
  })

  it('leaves the trigger to the admin when two production triggers name different branches', async () => {
    const { fetchFn } = workersFake({
      'multi-worker': [
        trigger('trigger-main', ['main'], DEPLOY),
        trigger('trigger-staging', ['staging'], DEPLOY),
      ],
    })
    const result = await collectCloudflareDeployTargets(clientFor(fetchFn), {
      now: NOW,
    })
    expect(result.workers[0]).toMatchObject({
      buildable: true,
      disabledReason: null,
      productionBranch: null,
      autoTriggerUuid: null,
    })
    expect(result.workers[0].triggers.map((item) => item.triggerUuid)).toEqual([
      'trigger-main',
      'trigger-staging',
    ])
  })

  it('drops deleted triggers, wildcard triggers and multi-branch triggers', async () => {
    const { fetchFn } = workersFake({
      'odd-worker': [
        trigger('trigger-deleted', ['main'], DEPLOY, {
          deleted_on: '2026-10-01T00:00:00Z',
        }),
        trigger('trigger-wildcard', ['*'], DEPLOY),
        trigger('trigger-two-branches', ['main', 'staging'], DEPLOY),
      ],
    })
    const result = await collectCloudflareDeployTargets(clientFor(fetchFn), {
      now: NOW,
    })
    expect(result.workers[0]).toMatchObject({
      buildable: false,
      disabledReason: 'no_builds',
      triggers: [],
    })
  })

  it('prefers the custom domain over the workers.dev address', async () => {
    const { fetchFn } = workersFake(
      { 'api-worker': [trigger('trigger-api', ['main'])] },
      {
        enabled: { 'api-worker': true },
        domains: { 'api-worker': ['api.example.com'] },
      },
    )
    const result = await collectCloudflareDeployTargets(clientFor(fetchFn), {
      now: NOW,
    })
    expect(result.workers[0]).toMatchObject({
      primaryDomain: 'api.example.com',
      suggestedHealthUrl: 'https://api.example.com/api/health',
    })
  })

  it('shows no workers.dev address while the script route is disabled', async () => {
    const { fetchFn } = workersFake(
      { 'quiet-worker': [trigger('trigger-quiet', ['main'])] },
      { enabled: { 'quiet-worker': false } },
    )
    const result = await collectCloudflareDeployTargets(clientFor(fetchFn), {
      now: NOW,
    })
    expect(result.workers[0].primaryDomain).toBeNull()
    expect(result.workers[0].suggestedHealthUrl).toBeNull()
  })

  it('skips the workers.dev lookups when the account has no subdomain', async () => {
    const { fetchFn, calls } = workersFake(
      { 'nosub-worker': [trigger('trigger-nosub', ['main'])] },
      { accountSubdomain: null },
    )
    const result = await collectCloudflareDeployTargets(clientFor(fetchFn), {
      now: NOW,
    })
    expect(result.workers[0].primaryDomain).toBeNull()
    expect(
      calls.some((call) => /\/workers\/scripts\/[^/]+\/subdomain/.test(call)),
    ).toBe(false)
  })

  it('does not ask for the account subdomain when there are no Workers', async () => {
    const { fetchFn, calls } = workersFake({})
    await collectCloudflareDeployTargets(clientFor(fetchFn), { now: NOW })
    expect(calls.some((call) => call.includes('/workers/subdomain'))).toBe(
      false,
    )
  })

  it('fails the whole list when one Worker cannot be read', async () => {
    const scripts = [{ id: 'broken', tag: 'tag-broken' }]
    const { fetchFn } = fakeCloudflare([
      [accountRoute('/pages/projects'), () => ok([])],
      [accountRoute('/workers/scripts'), () => ok(scripts)],
      [accountRoute('/workers/subdomain'), () => ok({ subdomain: 'acct' })],
      [
        accountRoute('/builds/workers/([^/]+)/triggers'),
        () =>
          json(403, {
            success: false,
            errors: [{ code: 10000, message: 'Authentication error' }],
            messages: [],
            result: null,
          }),
      ],
      [accountRoute('/workers/domains'), () => ok([])],
    ])

    await expect(
      collectCloudflareDeployTargets(clientFor(fetchFn), { now: NOW }),
    ).rejects.toBeInstanceOf(CloudflareApiError)
  })

  it('keeps the list order when Workers finish out of order', async () => {
    const names = Array.from(
      { length: 12 },
      (_, index) => `worker-${String(index).padStart(2, '0')}`,
    )
    let inFlight = 0
    let maxInFlight = 0
    const scripts = names.map((name) => ({ id: name, tag: `tag-${name}` }))
    const { fetchFn } = fakeCloudflare([
      [accountRoute('/pages/projects'), () => ok([])],
      // Shuffled on purpose: the list is sorted by name, not by reply order.
      [accountRoute('/workers/scripts'), () => ok([...scripts].reverse())],
      [accountRoute('/workers/subdomain'), () => ok({ subdomain: 'acct' })],
      [
        accountRoute('/workers/scripts/([^/]+)/subdomain'),
        () => ok({ enabled: true, previews_enabled: false }),
      ],
      [accountRoute('/workers/domains'), () => ok([])],
      [
        accountRoute('/builds/workers/([^/]+)/triggers'),
        async (_url, match) => {
          inFlight += 1
          maxInFlight = Math.max(maxInFlight, inFlight)
          const index = names.indexOf(match[1].replace(/^tag-/, ''))
          // Later names answer first.
          await new Promise((resolve) => setTimeout(resolve, (12 - index) * 3))
          inFlight -= 1
          return ok([trigger(`trigger-${index}`, ['main'])])
        },
      ],
    ])

    const result = await collectCloudflareDeployTargets(clientFor(fetchFn), {
      now: NOW,
    })
    expect(result.workers.map((target) => target.name)).toEqual(names)
    result.workers.forEach((target, index) => {
      expect(target.autoTriggerUuid).toBe(`trigger-${index}`)
    })
    expect(maxInFlight).toBeLessThanOrEqual(4)
    expect(maxInFlight).toBeGreaterThan(1)
  })
})

describe('trigger rules', () => {
  it('recognises the versions-upload preview command only', () => {
    expect(isPreviewDeployCommand(PREVIEW)).toBe(true)
    expect(isPreviewDeployCommand('pnpm wrangler versions upload --x')).toBe(
      true,
    )
    expect(isPreviewDeployCommand(DEPLOY)).toBe(false)
    expect(isPreviewDeployCommand(null)).toBe(false)
  })

  it('counts only non-wildcard branches, and needs a live UUID', () => {
    const raw = [
      {
        ...trigger('a', ['main']),
        triggerUuid: 'a',
        triggerName: 'a',
        branchIncludes: ['main'],
        buildCommand: null,
        deployCommand: DEPLOY,
        deletedOn: null,
      },
      {
        triggerUuid: null,
        triggerName: null,
        branchIncludes: ['main'],
        buildCommand: null,
        deployCommand: DEPLOY,
        deletedOn: null,
      },
      {
        triggerUuid: 'b',
        triggerName: 'b',
        branchIncludes: ['*', 'dev'],
        buildCommand: null,
        deployCommand: DEPLOY,
        deletedOn: null,
      },
      {
        triggerUuid: 'c',
        triggerName: 'c',
        branchIncludes: ['dev'],
        buildCommand: null,
        deployCommand: DEPLOY,
        deletedOn: 'x',
      },
    ]
    expect(usableBuildTriggers(raw).map((item) => item.triggerUuid)).toEqual([
      'a',
      'b',
    ])
  })

  it('auto-picks a single trigger, or the only non-preview one', () => {
    const prod: CloudflareBuildTrigger = {
      triggerUuid: 'p',
      name: null,
      branch: 'main',
      preview: false,
    }
    const preview: CloudflareBuildTrigger = {
      triggerUuid: 'v',
      name: null,
      branch: 'main',
      preview: true,
    }
    expect(autoPickTrigger([preview])).toBeNull()
    expect(autoPickTrigger([prod])).toBe(prod)
    expect(autoPickTrigger([preview, prod])).toBe(prod)
    expect(autoPickTrigger([])).toBeNull()
    expect(autoPickTrigger([prod, { ...prod, triggerUuid: 'q' }])).toBeNull()
    expect(autoPickTrigger([preview, preview, prod])).toBe(prod)
  })

  it('builds the health suggestion from a domain', () => {
    expect(suggestedHealthUrl('example.com')).toBe(
      'https://example.com/api/health',
    )
    expect(suggestedHealthUrl(null)).toBeNull()
  })
})

describe('mapWithConcurrency', () => {
  it('keeps the input order and never runs more than the limit at once', async () => {
    let inFlight = 0
    let maxInFlight = 0
    const result = await mapWithConcurrency([5, 1, 4, 2, 3], 2, async (ms) => {
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise((resolve) => setTimeout(resolve, ms))
      inFlight -= 1
      return ms * 10
    })
    expect(result).toEqual([50, 10, 40, 20, 30])
    expect(maxInFlight).toBe(2)
  })

  it('stops starting new items after a failure', async () => {
    const started: number[] = []
    await expect(
      mapWithConcurrency([1, 2, 3, 4, 5, 6], 1, async (item) => {
        started.push(item)
        if (item === 2) throw new Error('boom')
        return item
      }),
    ).rejects.toThrow('boom')
    expect(started).toEqual([1, 2])
  })
})
