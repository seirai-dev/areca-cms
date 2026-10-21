import { createClient } from 'redis'

import { env } from '#/env'
import { createLogger } from '#/server/log'

import type { RateLimitRule, RateLimitStore } from './rate-limit.ts'
import { consumeRateLimit } from './rate-limit.ts'

// Kept apart from rate-limit.server.ts, which imports auth. Auth itself needs
// the store (password reset budgets), so importing that module would cycle.

const log = createLogger('rate-limit')

const redis = createClient({
  url: env.REDIS_URL,
  socket: { connectTimeout: 1_000, reconnectStrategy: false },
})
let connectPromise: Promise<unknown> | undefined

redis.on('error', () => {
  // Command errors are reported by enforceRequestRateLimit without credentials.
})

export const rateLimitStore: RateLimitStore = {
  async increment(key, ttlSeconds) {
    if (!redis.isReady) {
      connectPromise ??= redis.connect().finally(() => {
        connectPromise = undefined
      })
      await connectPromise
    }

    const result = await redis.eval(
      `local count = redis.call('INCR', KEYS[1])
       if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
       return count`,
      { keys: [key], arguments: [String(ttlSeconds)] },
    )
    if (typeof result !== 'number') {
      throw new Error('Unexpected Redis rate-limit response')
    }
    return result
  },
}

/**
 * Budget for one keyed action, e.g. a reset request per email address. Fails
 * open when Redis is unavailable, like the request limiter.
 */
export async function allowKeyedAction(
  scope: string,
  identifier: string,
  rule: RateLimitRule,
): Promise<boolean> {
  try {
    return await consumeRateLimit(
      rateLimitStore,
      scope,
      identifier,
      rule,
      Date.now(),
    )
  } catch {
    log.error('Rate limiting unavailable; action allowed')
    return true
  }
}
