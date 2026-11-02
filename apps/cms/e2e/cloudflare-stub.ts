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
    return send(
      res,
      200,
      envelope([
        {
          name: 'northbound-site',
          subdomain: 'northbound-site.pages.dev',
          domains: ['northbound.example.com'],
          production_branch: 'main',
          source: { type: 'github' },
        },
      ]),
    )
  }

  if (route === `/accounts/${E2E_CLOUDFLARE_ACCOUNT_ID}/workers/scripts`) {
    return send(
      res,
      200,
      envelope([{ id: 'northbound-worker', tag: 'tag-northbound' }]),
    )
  }

  if (
    route ===
    `/accounts/${E2E_CLOUDFLARE_ACCOUNT_ID}/builds/workers/tag-northbound/triggers`
  ) {
    return send(
      res,
      200,
      envelope([
        {
          trigger_uuid: 'trigger-main',
          trigger_name: 'main',
          branch_includes: ['main'],
          build_command: 'pnpm build',
          deploy_command: 'npx wrangler deploy',
        },
      ]),
    )
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
