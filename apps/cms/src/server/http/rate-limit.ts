import { createHash } from 'node:crypto'

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
// Throttles bearer-token guessing against /api/metrics; a scraper needs ~4/min.
const METRICS_RULE = { limit: 60, windowSeconds: 60 } as const

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

function bearerToken(request: Request) {
  const header = request.headers.get('authorization')
  if (!header?.startsWith('Bearer ')) return null
  return header.slice('Bearer '.length).trim() || null
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
