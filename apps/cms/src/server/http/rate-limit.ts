import { createHash } from 'node:crypto'

import { authorizationToken, bearerToken } from './bearer-token'
import { OAuthTokenBodyTooLarge, readOAuthTokenBody } from './oauth-token-body'

export interface RateLimitStore {
  increment: (key: string, ttlSeconds: number) => Promise<number>
}

export interface RateLimitRule {
  limit: number
  windowSeconds: number
}

export interface RequestRateLimitDependencies {
  store: RateLimitStore
  resolveUserId: (request: Request) => Promise<string | null>
  trustProxy: boolean
  now?: () => number
  logError?: (message: string, error: unknown) => void
}

const MUTATION_RULE = { limit: 60, windowSeconds: 60 } as const
// Live visual editing posts the unsaved entry about every 150 ms while typing.
// Under the mutation budget that would be exhausted in seconds and starve
// autosave, so the live preview has its own budget per user.
const LIVE_PREVIEW_RULE = { limit: 600, windowSeconds: 60 } as const
const LIVE_PREVIEW_PATH = '/api/editor/live-preview'
const UPLOAD_RULE = { limit: 10, windowSeconds: 60 } as const
const SITE_API_RULE = { limit: 300, windowSeconds: 60 } as const
// Per AI key. Agents make several small calls per entry (read, write, preview).
const MCP_RULE = { limit: 120, windowSeconds: 60 } as const
// Per client IP, across all bearer tokens. Random fake tokens each get a fresh
// per-token bucket, so this is what throttles a flood of invalid keys.
const MCP_IP_RULE = { limit: 600, windowSeconds: 60 } as const
// Upload links (/api/upload/<token>). A session takes at most 20 files, so the
// per-link budget only stops a runaway client; the per-IP budget throttles a
// flood of made-up links. The user upload budget does not apply: the link is
// the limit.
const UPLOAD_LINK_RULE = { limit: 120, windowSeconds: 60 } as const
const UPLOAD_LINK_IP_RULE = { limit: 600, windowSeconds: 60 } as const
const UPLOAD_LINK_PREFIX = '/api/upload/'
// Throttles bearer-token guessing against /api/metrics; a scraper needs ~4/min.
const METRICS_RULE = { limit: 60, windowSeconds: 60 } as const
// Anonymous client registration (RFC 7591) is open so AI apps can connect. A
// real user registers a handful of apps; a flood from one address is abuse.
const OAUTH_REGISTER_IP_RULE = { limit: 20, windowSeconds: 60 * 60 } as const
// Caps the whole deployment, which also covers clients that share 'unknown'.
const OAUTH_REGISTER_GLOBAL_RULE = {
  limit: 300,
  windowSeconds: 60 * 60,
} as const
// Per app and address. Refresh tokens rotate, so a busy app refreshes about
// hourly per user; this allows bursts without letting one client flood /token.
const OAUTH_TOKEN_RULE = { limit: 60, windowSeconds: 60 } as const
const OAUTH_TOKEN_IP_RULE = { limit: 120, windowSeconds: 60 } as const
const OAUTH_TOKEN_GLOBAL_RULE = { limit: 600, windowSeconds: 60 } as const

// Liveness/readiness probes must never be throttled (orchestrators poll often
// and a 429 would look like an outage).
const PROBE_PATHS = new Set(['/api/health', '/api/health/ready'])

const SITE_TOKEN_PATHS = new Set([
  '/api/sites/manifest',
  '/api/sites/snapshot/current',
])

const UPLOAD_PATHS = new Set([
  '/api/assets/upload',
  '/api/admin/branding/upload',
])

function fingerprint(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

export function getClientIp(request: Request, trustProxy: boolean) {
  if (!trustProxy) return 'unknown'

  const forwarded = request.headers.get('x-forwarded-for')
  const firstForwarded = forwarded?.split(',')[0]?.trim()
  return (
    firstForwarded ||
    request.headers.get('x-real-ip')?.trim() ||
    request.headers.get('cf-connecting-ip')?.trim() ||
    'unknown'
  )
}

function tooManyRequests(rule: RateLimitRule, now: number) {
  const resetSeconds =
    rule.windowSeconds - (Math.floor(now / 1_000) % rule.windowSeconds)
  return Response.json(
    { error: 'Too many requests' },
    {
      status: 429,
      headers: {
        'RateLimit-Limit': String(rule.limit),
        'RateLimit-Remaining': '0',
        'RateLimit-Reset': String(resetSeconds),
        'Retry-After': String(resetSeconds),
      },
    },
  )
}

export async function consumeRateLimit(
  store: RateLimitStore,
  scope: string,
  identifier: string,
  rule: RateLimitRule,
  now: number,
) {
  const window = Math.floor(now / (rule.windowSeconds * 1_000))
  const key = `areca:rate-limit:${scope}:${fingerprint(identifier)}:${window}`
  return (await store.increment(key, rule.windowSeconds + 1)) <= rule.limit
}

type BudgetContext = {
  request: Request
  path: string
  dependencies: RequestRateLimitDependencies
}

/** One counter a request consumes. `key` returns null to skip it. */
type Budget = {
  scope: string
  rule: RateLimitRule
  key: (context: BudgetContext) => string | null | Promise<string | null>
}

type Route = {
  match: (path: string, method: string) => boolean
  /** Consumed in order; the first one over its limit answers 429. Empty: exempt. */
  budgets: Budget[]
  /** A response for an error thrown while consuming, instead of failing open. */
  onError?: (error: unknown, request: Request) => Promise<Response | null>
}

const clientIp = ({ request, dependencies }: BudgetContext) =>
  getClientIp(request, dependencies.trustProxy)

/**
 * The client IP, or null without a real one: behind no trusted proxy every
 * client is 'unknown', and one shared bucket would throttle them all together.
 */
const knownIp = (context: BudgetContext) => {
  const ip = clientIp(context)
  return ip === 'unknown' ? null : `ip:${ip}`
}

const userOrIp = async (context: BudgetContext) => {
  const userId = await context.dependencies.resolveUserId(context.request)
  return userId ? `user:${userId}` : `ip:${clientIp(context)}`
}

const tokenBodyTooLarge = () =>
  Response.json({ error: 'Token request body is too large' }, { status: 413 })

const ROUTES: Route[] = [
  {
    match: (path, method) =>
      path === '/api/auth/oauth2/register' && method === 'POST',
    budgets: [
      {
        scope: 'oauth-register-ip',
        rule: OAUTH_REGISTER_IP_RULE,
        key: knownIp,
      },
      {
        scope: 'oauth-register-global',
        rule: OAUTH_REGISTER_GLOBAL_RULE,
        key: () => 'all',
      },
    ],
  },
  {
    match: (path, method) =>
      path === '/api/auth/oauth2/token' && method === 'POST',
    // A caller controls client_id, including invalid IDs. Independent budgets
    // must run before reading the body or selecting a per-client bucket.
    budgets: [
      {
        scope: 'oauth-token-global',
        rule: OAUTH_TOKEN_GLOBAL_RULE,
        key: () => 'all',
      },
      { scope: 'oauth-token-ip', rule: OAUTH_TOKEN_IP_RULE, key: knownIp },
      {
        scope: 'oauth-token',
        rule: OAUTH_TOKEN_RULE,
        key: async (context) =>
          `client:${(await clientIdOf(context.request)) ?? 'anonymous'}|ip:${clientIp(context)}`,
      },
    ],
    onError: async (error, request) => {
      if (error instanceof OAuthTokenBodyTooLarge) return tokenBodyTooLarge()
      // Redis outages fail open for the budget, not for request-size validation.
      try {
        await readOAuthTokenBody(request)
      } catch (bodyError) {
        if (bodyError instanceof OAuthTokenBodyTooLarge) {
          return tokenBodyTooLarge()
        }
      }
      return null
    },
  },
  {
    match: (path) => path === '/api/auth' || path.startsWith('/api/auth/'),
    budgets: [],
  },
  {
    match: (path, method) =>
      PROBE_PATHS.has(path) && (method === 'GET' || method === 'HEAD'),
    budgets: [],
  },
  {
    match: (path) => path === '/api/metrics',
    budgets: [
      {
        scope: 'metrics',
        rule: METRICS_RULE,
        key: (context) => `ip:${clientIp(context)}`,
      },
    ],
  },
  {
    match: (path, method) => path === LIVE_PREVIEW_PATH && method === 'POST',
    budgets: [
      { scope: 'live-preview', rule: LIVE_PREVIEW_RULE, key: userOrIp },
    ],
  },
  // The MCP endpoint has its own budgets and is exempt from the general
  // mutation budget (POST), which would otherwise throttle one agent session by
  // IP. Two budgets apply: a per-IP one that also catches invalid tokens, and a
  // per-key one keyed by the SHA-256 of the bearer token (never the raw secret).
  // The per-IP budget needs a real client IP. Keys are 256-bit random values
  // checked with one indexed lookup, so skipping it without one costs little.
  // The agency connector (/api/agency/mcp) shares these budgets: one key, every site.
  {
    match: (path) =>
      path === '/api/mcp' ||
      path.startsWith('/api/mcp/') ||
      path === '/api/agency/mcp',
    budgets: [
      { scope: 'mcp-ip', rule: MCP_IP_RULE, key: knownIp },
      {
        scope: 'mcp',
        rule: MCP_RULE,
        key: (context) => {
          const token = authorizationToken(context.request)
          return token
            ? `token:${fingerprint(token)}`
            : `ip:${clientIp(context)}`
        },
      },
    ],
  },
  // Upload links: per link (hashed, never the raw token) and per IP.
  {
    match: (path) => path.startsWith(UPLOAD_LINK_PREFIX),
    budgets: [
      { scope: 'upload-link-ip', rule: UPLOAD_LINK_IP_RULE, key: knownIp },
      {
        scope: 'upload-link',
        rule: UPLOAD_LINK_RULE,
        key: ({ path }) =>
          `link:${fingerprint(path.slice(UPLOAD_LINK_PREFIX.length).split('/')[0] ?? '')}`,
      },
    ],
  },
  {
    match: (path) => SITE_TOKEN_PATHS.has(path),
    budgets: [
      {
        scope: 'site-api',
        rule: SITE_API_RULE,
        key: (context) => {
          const token = bearerToken(context.request)
          return token ? `token:${token}` : `ip:${clientIp(context)}`
        },
      },
    ],
  },
  {
    match: (path) => UPLOAD_PATHS.has(path),
    budgets: [{ scope: 'upload', rule: UPLOAD_RULE, key: userOrIp }],
  },
  {
    match: (_path, method) => !['GET', 'HEAD', 'OPTIONS'].includes(method),
    budgets: [{ scope: 'mutation', rule: MUTATION_RULE, key: userOrIp }],
  },
]

async function consumeBudgets(route: Route, context: BudgetContext) {
  const { dependencies } = context
  const now = dependencies.now?.() ?? Date.now()
  try {
    for (const budget of route.budgets) {
      const identifier = await budget.key(context)
      if (identifier === null) continue
      const allowed = await consumeRateLimit(
        dependencies.store,
        budget.scope,
        identifier,
        budget.rule,
        now,
      )
      if (!allowed) return tooManyRequests(budget.rule, now)
    }
    return null
  } catch (error) {
    const response = await route.onError?.(error, context.request)
    if (response) return response
    dependencies.logError?.('Rate limiting unavailable; request allowed', error)
    return null
  }
}

/**
 * Returns a 429 response when blocked and null when the request may continue.
 * The store falls back to in-memory counters when Redis fails, so the budgets
 * still apply. An unexpected error lets the request through, so one bug does
 * not block every request.
 */
export async function enforceRequestRateLimit(
  request: Request,
  dependencies: RequestRateLimitDependencies,
): Promise<Response | null> {
  const url = new URL(request.url)
  const path =
    url.pathname.length > 1 ? url.pathname.replace(/\/+$/, '') : url.pathname
  const method = request.method.toUpperCase()
  const route = ROUTES.find((candidate) => candidate.match(path, method))
  if (!route || route.budgets.length === 0) return null
  return consumeBudgets(route, { request, path, dependencies })
}

/**
 * The client id of a token request, from the form body, the JSON body or HTTP
 * Basic credentials. Only used to pick a rate-limit bucket, so it does not
 * need to be verified here.
 */
async function clientIdOf(request: Request): Promise<string | null> {
  const text = await readOAuthTokenBody(request)
  const basic = request.headers.get('authorization')
  if (basic?.toLowerCase().startsWith('basic ')) {
    try {
      const decoded = Buffer.from(basic.slice(6).trim(), 'base64').toString()
      const id = decoded.split(':')[0]
      if (id) return id
    } catch {
      // Malformed credentials fall through to the body.
    }
  }
  try {
    if (!text) return null
    const contentType = request.headers.get('content-type') ?? ''
    if (contentType.includes('application/json')) {
      const parsed: unknown = JSON.parse(text)
      if (!parsed || typeof parsed !== 'object' || !('client_id' in parsed)) {
        return null
      }
      return typeof parsed.client_id === 'string' ? parsed.client_id : null
    }
    return new URLSearchParams(text).get('client_id')
  } catch {
    return null
  }
}
