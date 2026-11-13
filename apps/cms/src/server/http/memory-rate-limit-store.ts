import type { RateLimitStore } from './rate-limit.ts'

// Bounds memory under a flood of distinct keys. Past this size the oldest
// counters are dropped, so a determined flood can reset its own budgets.
const MAX_KEYS = 50_000
// A full store sweeps expired counters at most this often; between sweeps it
// only drops the oldest key, so a flood does not walk every key per request.
const SWEEP_INTERVAL_MS = 1_000

/**
 * In-process counters with the same semantics as the Redis script: a window
 * starts at the first increment and lasts `ttlSeconds`. Each process counts
 * on its own, so this is only a fallback while Redis is unavailable.
 */
export function createMemoryRateLimitStore(
  now: () => number = Date.now,
): RateLimitStore {
  const counters = new Map<string, { count: number; expiresAt: number }>()

  let nextSweepAt = 0

  function prune(at: number) {
    if (at >= nextSweepAt) {
      nextSweepAt = at + SWEEP_INTERVAL_MS
      for (const [key, counter] of counters) {
        if (counter.expiresAt <= at) counters.delete(key)
      }
    }
    if (counters.size < MAX_KEYS) return
    const oldest = counters.keys().next()
    if (!oldest.done) counters.delete(oldest.value)
  }

  return {
    async increment(key, ttlSeconds) {
      const at = now()
      if (counters.size >= MAX_KEYS) prune(at)
      const current = counters.get(key)
      if (current && current.expiresAt > at) {
        current.count += 1
        return current.count
      }
      counters.set(key, { count: 1, expiresAt: at + ttlSeconds * 1_000 })
      return 1
    },
  }
}
