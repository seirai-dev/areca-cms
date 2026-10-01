import { createClient } from 'redis'

import { env } from '#/env'
import { auth } from '#/lib/auth'
import { createLogger } from '#/server/log'

import type { RateLimitStore } from './rate-limit.ts'
import { enforceRequestRateLimit } from './rate-limit.ts'

const log = createLogger('rate-limit')

const redis = createClient({
  url: env.REDIS_URL,
  socket: { connectTimeout: 1_000, reconnectStrategy: false },
})
let connectPromise: Promise<unknown> | undefined

redis.on('error', () => {
  // Command errors are reported by enforceRequestRateLimit without credentials.
})

const store: RateLimitStore = {
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

export function enforceCmsRateLimit(request: Request) {
  return enforceRequestRateLimit(request, {
    store,
    trustProxy: env.RATE_LIMIT_TRUST_PROXY,
    resolveUserId: async (incoming) => {
      const session = await auth.api.getSession({ headers: incoming.headers })
      return session?.user.id ?? null
    },
    // Do not log the Redis error object: connection errors may contain a URL.
    logError: (message) => log.error(message),
  })
}
