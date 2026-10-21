import { env } from '#/env'
import { auth } from '#/lib/auth'
import { createLogger } from '#/server/log'

import type { RateLimitRule } from './rate-limit.ts'
import { enforceRequestRateLimit } from './rate-limit.ts'
import { allowKeyedAction, rateLimitStore } from './rate-limit-store.server.ts'

const log = createLogger('rate-limit')

export function enforceCmsRateLimit(request: Request) {
  return enforceRequestRateLimit(request, {
    store: rateLimitStore,
    trustProxy: env.RATE_LIMIT_TRUST_PROXY,
    resolveUserId: async (incoming) => {
      const session = await auth.api.getSession({ headers: incoming.headers })
      return session?.user.id ?? null
    },
    // Do not log the Redis error object: connection errors may contain a URL.
    logError: (message) => log.error(message),
  })
}

/**
 * Per-user budget for an expensive action (e.g. a paid AI call). Like the
 * request limiter it fails open when Redis is unavailable.
 */
export function allowUserAction(
  scope: string,
  userId: string,
  rule: RateLimitRule,
): Promise<boolean> {
  return allowKeyedAction(scope, `user:${userId}`, rule)
}
