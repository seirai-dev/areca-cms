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
const UPLOAD_RULE = { limit: 10, windowSeconds: 60 } as const
const SITE_API_RULE = { limit: 300, windowSeconds: 60 } as const
// Per AI key. Agents make several small calls per entry (read, write, preview).
const MCP_RULE = { limit: 120, windowSeconds: 60 } as const
// Per client IP, across all bearer tokens. Random fake tokens each get a fresh
// per-token bucket, so this is what throttles a flood of invalid keys.
const MCP_IP_RULE = { limit: 600, windowSeconds: 60 } as const
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

async function enforceOAuthRegister(
  request: Request,
  dependencies: RequestRateLimitDependencies,
): Promise<Response | null> {
  const now = dependencies.now?.() ?? Date.now()
  try {
    const ip = getClientIp(request, dependencies.trustProxy)
    if (ip !== 'unknown') {
      const ipAllowed = await consumeRateLimit(
        dependencies.store,
        'oauth-register-ip',
        `ip:${ip}`,
        OAUTH_REGISTER_IP_RULE,
        now,
      )
      if (!ipAllowed) return tooManyRequests(OAUTH_REGISTER_IP_RULE, now)
    }
    const globalAllowed = await consumeRateLimit(
      dependencies.store,
      'oauth-register-global',
      'all',
      OAUTH_REGISTER_GLOBAL_RULE,
      now,
    )
    return globalAllowed
      ? null
      : tooManyRequests(OAUTH_REGISTER_GLOBAL_RULE, now)
  } catch (error) {
    dependencies.logError?.('Rate limiting unavailable; request allowed', error)
    return null
  }
}

async function enforceOAuthToken(
  request: Request,
  dependencies: RequestRateLimitDependencies,
): Promise<Response | null> {
  const now = dependencies.now?.() ?? Date.now()
  try {
    const ip = getClientIp(request, dependencies.trustProxy)
    // A caller controls client_id, including invalid IDs. Independent budgets
    // must run before reading the body or selecting a per-client bucket.
    const globalAllowed = await consumeRateLimit(
      dependencies.store,
      'oauth-token-global',
      'all',
      OAUTH_TOKEN_GLOBAL_RULE,
      now,
    )
    if (!globalAllowed) return tooManyRequests(OAUTH_TOKEN_GLOBAL_RULE, now)
    if (ip !== 'unknown') {
      const ipAllowed = await consumeRateLimit(
        dependencies.store,
        'oauth-token-ip',
        `ip:${ip}`,
        OAUTH_TOKEN_IP_RULE,
        now,
      )
      if (!ipAllowed) return tooManyRequests(OAUTH_TOKEN_IP_RULE, now)
    }
    const clientId = (await clientIdOf(request)) ?? 'anonymous'
    const allowed = await consumeRateLimit(
      dependencies.store,
      'oauth-token',
      `client:${clientId}|ip:${ip}`,
      OAUTH_TOKEN_RULE,
      now,
    )
    return allowed ? null : tooManyRequests(OAUTH_TOKEN_RULE, now)
  } catch (error) {
    if (error instanceof OAuthTokenBodyTooLarge) {
      return Response.json(
        { error: 'Token request body is too large' },
        { status: 413 },
      )
    }
    // Redis outages fail open for the budget, not for request-size validation.
    try {
      await readOAuthTokenBody(request)
    } catch (bodyError) {
      if (bodyError instanceof OAuthTokenBodyTooLarge) {
        return Response.json(
          { error: 'Token request body is too large' },
          { status: 413 },
        )
      }
    }
    dependencies.logError?.('Rate limiting unavailable; request allowed', error)
    return null
  }
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

/**
 * Returns a 429 response when blocked and null when the request may continue.
 * Redis failures deliberately fail open so an infrastructure outage does not
 * take down the CMS; the caller-provided logger still makes that state visible.
 */
export async function enforceRequestRateLimit(
  request: Request,
  dependencies: RequestRateLimitDependencies,
): Promise<Response | null> {
  const url = new URL(request.url)
  const path =
    url.pathname.length > 1 ? url.pathname.replace(/\/+$/, '') : url.pathname

  if (path === '/api/auth/oauth2/register' && request.method === 'POST') {
    return enforceOAuthRegister(request, dependencies)
  }
  if (path === '/api/auth/oauth2/token' && request.method === 'POST') {
    return enforceOAuthToken(request, dependencies)
  }
  if (path === '/api/auth' || path.startsWith('/api/auth/')) return null

  const method = request.method.toUpperCase()
  if (PROBE_PATHS.has(path) && (method === 'GET' || method === 'HEAD')) {
    return null
  }

  if (path === '/api/metrics') {
    try {
      const allowed = await consumeRateLimit(
        dependencies.store,
        'metrics',
        `ip:${getClientIp(request, dependencies.trustProxy)}`,
        METRICS_RULE,
        dependencies.now?.() ?? Date.now(),
      )
      return allowed
        ? null
        : tooManyRequests(METRICS_RULE, dependencies.now?.() ?? Date.now())
    } catch (error) {
      dependencies.logError?.(
        'Rate limiting unavailable; request allowed',
        error,
      )
      return null
    }
  }

  // The MCP endpoint has its own budgets and is exempt from the general
  // mutation budget (POST), which would otherwise throttle one agent session by
  // IP. Two budgets apply: a per-IP one that also catches invalid tokens, and a
  // per-key one keyed by the SHA-256 of the bearer token (never the raw secret).
  // The per-IP budget needs a real client IP: without a trusted proxy every
  // client is 'unknown', and one shared bucket would throttle all agents
  // together. Keys are 256-bit random values checked with one indexed lookup,
  // so skipping it there costs little.
  if (path === '/api/mcp' || path.startsWith('/api/mcp/')) {
    const now = dependencies.now?.() ?? Date.now()
    try {
      const ip = getClientIp(request, dependencies.trustProxy)
      if (ip !== 'unknown') {
        const ipAllowed = await consumeRateLimit(
          dependencies.store,
          'mcp-ip',
          `ip:${ip}`,
          MCP_IP_RULE,
          now,
        )
        if (!ipAllowed) return tooManyRequests(MCP_IP_RULE, now)
      }

      const token = authorizationToken(request)
      const identifier = token ? `token:${fingerprint(token)}` : `ip:${ip}`
      const allowed = await consumeRateLimit(
        dependencies.store,
        'mcp',
        identifier,
        MCP_RULE,
        now,
      )
      return allowed ? null : tooManyRequests(MCP_RULE, now)
    } catch (error) {
      dependencies.logError?.(
        'Rate limiting unavailable; request allowed',
        error,
      )
      return null
    }
  }

  const isSiteApi = SITE_TOKEN_PATHS.has(path)
  const isUpload =
    path === '/api/assets/upload' || path === '/api/admin/branding/upload'
  const isMutation = !['GET', 'HEAD', 'OPTIONS'].includes(
    request.method.toUpperCase(),
  )

  if (!isSiteApi && !isUpload && !isMutation) return null

  const now = dependencies.now?.() ?? Date.now()

  try {
    if (isSiteApi) {
      const token = bearerToken(request)
      const identifier = token
        ? `token:${token}`
        : `ip:${getClientIp(request, dependencies.trustProxy)}`
      const allowed = await consumeRateLimit(
        dependencies.store,
        'site-api',
        identifier,
        SITE_API_RULE,
        now,
      )
      return allowed ? null : tooManyRequests(SITE_API_RULE, now)
    }

    const userId = await dependencies.resolveUserId(request)
    const identifier = userId
      ? `user:${userId}`
      : `ip:${getClientIp(request, dependencies.trustProxy)}`
    const rule = isUpload ? UPLOAD_RULE : MUTATION_RULE
    const scope = isUpload ? 'upload' : 'mutation'
    const allowed = await consumeRateLimit(
      dependencies.store,
      scope,
      identifier,
      rule,
      now,
    )
    return allowed ? null : tooManyRequests(rule, now)
  } catch (error) {
    dependencies.logError?.('Rate limiting unavailable; request allowed', error)
    return null
  }
}
