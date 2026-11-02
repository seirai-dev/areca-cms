import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'

/**
 * A stand-in for the Cloudflare API used by the Cloudflare credentials e2e
 * spec. Started once by `global-setup.ts` on a fixed port, and the CMS dev
 * server reaches it through CLOUDFLARE_API_BASE_URL (see playwright.config.ts).
 *
 * The behaviour depends on the token, so specs need no shared state: a token
 * containing `disabled` gets a disabled status, one containing `nopages` is
 * refused for Pages, and any other `cfut_e2e_` token passes every check.
 *
 * The account holds two Pages projects (one git-connected, one direct upload)
 * and four Workers (one with a production and a preview trigger, one with
 * none, one with only a preview trigger, and one plain Worker), so the
 * deployment target picker has both groups and disabled rows to show.
 */

export const CLOUDFLARE_STUB_PORT = Number(
  process.env.CLOUDFLARE_STUB_PORT ?? 4607,
)
export const CLOUDFLARE_STUB_BASE_URL = `http://127.0.0.1:${CLOUDFLARE_STUB_PORT}/client/v4`
export const E2E_CLOUDFLARE_ACCOUNT_ID = '0123456789abcdef0123456789abcdef'
export const E2E_CLOUDFLARE_TOKENS = {
  full: 'cfut_e2e_full_0001',
  noPages: 'cfut_e2e_nopages_0002',
  disabled: 'cfut_e2e_disabled_0003',
} as const

/** The Pages projects the stub lists. `marketing-site` is buildable from git, `legacy-upload` is a direct upload. */
const E2E_PAGES_PROJECTS = [
  {
    name: 'northbound-site',
    subdomain: 'northbound-site.pages.dev',
    domains: ['northbound.example.com'],
    production_branch: 'main',
    source: { type: 'github' },
  },
  {
    name: 'marketing-site',
    subdomain: 'marketing-site.pages.dev',
    domains: ['marketing.example.com'],
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
]

/** The account's workers.dev subdomain. */
export const E2E_WORKERS_SUBDOMAIN = 'e2e-acct'
/** Trigger UUIDs and script tags are real UUID and 32-hex shapes: the CMS validates them. */
export const E2E_SHOP_PROD_TRIGGER = '5b1f0c2e-7a3d-4c8e-9f10-2d4a6b8c0e11'
export const E2E_SHOP_PREVIEW_TRIGGER = '6c2e1d3f-8b4e-4d9f-8a21-3e5b7c9d1f22'
export const E2E_SHOP_TAG = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'
export const E2E_PLAIN_TAG = '0f1e2d3c4b5a69788796a5b4c3d2e1f0'
export const E2E_PREVIEW_ONLY_TAG = 'e5f4d3c2b1a0918f7e6d5c4b3a291807'

const E2E_WORKERS = [
  {
    name: 'northbound-worker',
    tag: 'tag-northbound',
    workersDev: false,
    domains: ['northbound-api.example.com'],
    triggers: [
      {
        trigger_uuid: 'trigger-main',
        trigger_name: 'main',
        branch_includes: ['main'],
        build_command: 'pnpm build',
        deploy_command: 'npx wrangler deploy',
        deleted_on: null,
      },
    ],
  },
  {
    // A production trigger and a versions-upload preview on the same branch:
    // the production one is picked, and the select offers both.
    name: 'shop-worker',
    tag: E2E_SHOP_TAG,
    workersDev: true,
    domains: [],
    triggers: [
      {
        trigger_uuid: E2E_SHOP_PREVIEW_TRIGGER,
        trigger_name: 'preview',
        branch_includes: ['main'],
        build_command: 'pnpm build',
        deploy_command: 'npx wrangler versions upload',
        deleted_on: null,
      },
      {
        trigger_uuid: E2E_SHOP_PROD_TRIGGER,
        trigger_name: 'main',
        branch_includes: ['main'],
        build_command: 'pnpm build',
        deploy_command: 'npx wrangler deploy',
        deleted_on: null,
      },
    ],
  },
  {
    name: 'plain-worker',
    tag: E2E_PLAIN_TAG,
    workersDev: false,
    domains: [],
    triggers: [],
  },
  {
    // Only a versions-upload preview trigger: listed, but not buildable.
    name: 'preview-only-worker',
    tag: E2E_PREVIEW_ONLY_TAG,
    workersDev: false,
    domains: [],
    triggers: [
      {
        trigger_uuid: '7d3f2e1c-9a4b-4e5f-8b32-4f6a8c0d2e33',
        trigger_name: 'preview',
        branch_includes: ['main'],
        build_command: 'pnpm build',
        deploy_command: 'npx wrangler versions upload',
        deleted_on: null,
      },
    ],
  },
]

const PREFIX = '/client/v4'

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

function envelope(result: unknown) {
  return { success: true, errors: [], messages: [], result }
}

function refused(message: string) {
  return {
    success: false,
    errors: [{ code: 10000, message }],
    messages: [],
    result: null,
  }
}

function handle(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', CLOUDFLARE_STUB_BASE_URL)
  const path = url.pathname
  if (!path.startsWith(PREFIX)) return send(res, 404, refused('Not found'))

  const auth = req.headers.authorization ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  if (!token.startsWith('cfut_e2e_')) {
    return send(res, 401, refused('Invalid API Token'))
  }

  const route = path.slice(PREFIX.length)
  if (req.method !== 'GET') return send(res, 405, refused('Method not allowed'))

  if (route === '/user/tokens/verify') {
    const status = token.includes('disabled') ? 'disabled' : 'active'
    return send(
      res,
      200,
      envelope({
        id: 'stub-token',
        status,
        expires_on: '2030-01-01T00:00:00Z',
      }),
    )
  }

  if (route === `/accounts/${E2E_CLOUDFLARE_ACCOUNT_ID}/pages/projects`) {
    if (token.includes('nopages')) {
      return send(res, 403, refused('Authentication error'))
    }
    // The real API rejects Pages list requests with per_page above 10.
    const perPage = Number(url.searchParams.get('per_page') ?? '10')
    if (perPage > 10) {
      return send(
        res,
        400,
        refused(
          'Invalid list options provided. Review the `page` or `per_page` parameter.',
        ),
      )
    }
    return send(res, 200, envelope(E2E_PAGES_PROJECTS))
  }

  if (route === `/accounts/${E2E_CLOUDFLARE_ACCOUNT_ID}/workers/scripts`) {
    return send(
      res,
      200,
      envelope(
        E2E_WORKERS.map((worker) => ({ id: worker.name, tag: worker.tag })),
      ),
    )
  }

  if (route === `/accounts/${E2E_CLOUDFLARE_ACCOUNT_ID}/workers/subdomain`) {
    return send(res, 200, envelope({ subdomain: E2E_WORKERS_SUBDOMAIN }))
  }

  const workerRoute = route.match(
    new RegExp(
      `^/accounts/${E2E_CLOUDFLARE_ACCOUNT_ID}/workers/scripts/([^/]+)/subdomain$`,
    ),
  )
  if (workerRoute) {
    const worker = E2E_WORKERS.find((item) => item.name === workerRoute[1])
    return send(
      res,
      200,
      envelope({
        enabled: worker?.workersDev ?? false,
        previews_enabled: false,
      }),
    )
  }

  if (route === `/accounts/${E2E_CLOUDFLARE_ACCOUNT_ID}/workers/domains`) {
    const service = url.searchParams.get('service') ?? ''
    const worker = E2E_WORKERS.find((item) => item.name === service)
    return send(
      res,
      200,
      envelope((worker?.domains ?? []).map((hostname) => ({ hostname }))),
    )
  }

  const triggerRoute = route.match(
    new RegExp(
      `^/accounts/${E2E_CLOUDFLARE_ACCOUNT_ID}/builds/workers/([^/]+)/triggers$`,
    ),
  )
  if (triggerRoute) {
    const worker = E2E_WORKERS.find((item) => item.tag === triggerRoute[1])
    return send(res, 200, envelope(worker ? worker.triggers : []))
  }

  return send(res, 404, refused('No such route in the Cloudflare stub'))
}

/** Starts the stub and resolves with a function that stops it. */
export function startCloudflareStub(): Promise<() => Promise<void>> {
  const server: Server = createServer(handle)
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(CLOUDFLARE_STUB_PORT, '127.0.0.1', () => {
      server.off('error', reject)
      resolve(
        () =>
          new Promise<void>((done, fail) =>
            server.close((error) => (error ? fail(error) : done())),
          ),
      )
    })
  })
}
