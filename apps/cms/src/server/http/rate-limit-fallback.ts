import type { RateLimitStore } from './rate-limit.ts'

/**
 * Counts in `primary` (shared Redis) and falls back to `fallback` (this
 * instance's memory) when it errors, so the budgets keep applying during an
 * outage. After a failure the primary is skipped for `retryAfterMs`, so an
 * outage does not add a connect timeout to every request.
 */
export function createFallbackRateLimitStore({
  primary,
  fallback,
  retryAfterMs = 5_000,
  now = Date.now,
  onDegraded,
  onRecovered,
}: {
  primary: RateLimitStore
  fallback: RateLimitStore
  retryAfterMs?: number
  now?: () => number
  /** Called once when counting moves to the fallback. Never gets the error. */
  onDegraded?: () => void
  onRecovered?: () => void
}): RateLimitStore {
  let degraded = false
  let retryAt = 0

  return {
    async increment(key, ttlSeconds) {
      const at = now()
      if (at < retryAt) return fallback.increment(key, ttlSeconds)
      try {
        const count = await primary.increment(key, ttlSeconds)
        if (degraded) {
          degraded = false
          onRecovered?.()
        }
        return count
      } catch {
        retryAt = at + retryAfterMs
        if (!degraded) {
          degraded = true
          onDegraded?.()
        }
        return fallback.increment(key, ttlSeconds)
      }
    },
  }
}
