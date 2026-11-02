/** Resolves after `ms` milliseconds. Shared by the deployment adapters. */
export function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

/**
 * Backoff for status polls inside waitForCompletion: about 30 seconds in total
 * before a poll gives up and the failure is thrown.
 */
export const POLL_RETRY_DELAYS_MS = [
  500, 1_000, 2_000, 4_000, 8_000, 15_000,
] as const

/** Transient HTTP statuses: 408, 429 and any 5xx. */
export function isTransientStatus(status: number) {
  return status === 408 || status === 429 || (status >= 500 && status <= 599)
}

export function formatRetryDelay(ms: number) {
  return ms < 1_000 ? `${ms}ms` : `${ms / 1_000}s`
}

export type RetryTransientOptions = {
  /** Wait before each retry; the length is the number of retries. */
  delays: readonly number[]
  isTransient: (error: unknown) => boolean
  sleep: (ms: number) => Promise<void>
  now: () => number
  /** Epoch ms after which no retry starts. Each wait is capped to it. */
  deadline: number
  onRetry?: (error: unknown, delayMs: number) => void
}

/**
 * Runs `operation`, retrying transient failures after each delay in turn. A
 * non-transient failure, an exhausted budget or a passed deadline rethrows the
 * last error. Only reads and idempotent writes may use this, never a POST that
 * can start work.
 */
export async function retryTransient<T>(
  operation: () => Promise<T>,
  options: RetryTransientOptions,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await operation()
    } catch (error) {
      if (attempt >= options.delays.length || !options.isTransient(error)) {
        throw error
      }
      const delay = options.delays[attempt]
      const remaining = options.deadline - options.now()
      if (remaining <= 0) throw error
      const wait = Math.min(delay, remaining)
      options.onRetry?.(error, wait)
      await options.sleep(wait)
    }
  }
}
