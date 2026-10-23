// Bounded retries for the container startup steps (database, bucket). Every
// step shares one deadline, so a dependency that never comes up makes the
// container exit non-zero with a clear message instead of hanging.

export const DEFAULT_STARTUP_DEADLINE_SECONDS = 60

const FIRST_DELAY_MS = 1000
const MAX_DELAY_MS = 5000

export class StartupDeadlineError extends Error {
  name = 'StartupDeadlineError'
}

/**
 * The overall startup deadline in milliseconds. `STARTUP_DEADLINE_SECONDS`
 * overrides the default; anything that is not a positive number is an error.
 */
export function startupDeadlineMs(env = process.env) {
  const raw = env.STARTUP_DEADLINE_SECONDS?.trim()
  if (!raw) return DEFAULT_STARTUP_DEADLINE_SECONDS * 1000
  const seconds = Number(raw)
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error(
      `STARTUP_DEADLINE_SECONDS must be a positive number of seconds, got "${raw}"`,
    )
  }
  return seconds * 1000
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Runs `attempt` until it resolves or `deadline` (a `Date.now()` value) passes.
 * Waits between attempts with exponential backoff from one second, capped at
 * five seconds, and never sleeps past the deadline. Throws a
 * StartupDeadlineError carrying the last failure once time is up.
 *
 * @template T
 * @param {string} label names the dependency in log lines
 * @param {() => Promise<T>} attempt
 * @param {{
 *   deadline: number,
 *   log?: (message: string) => void,
 *   now?: () => number,
 *   sleep?: (ms: number) => Promise<void>,
 * }} options
 * @returns {Promise<T>}
 */
export async function retryUntilDeadline(
  label,
  attempt,
  { deadline, log = console.log, now = Date.now, sleep = defaultSleep },
) {
  let delay = FIRST_DELAY_MS
  for (let number = 1; ; number += 1) {
    try {
      return await attempt()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const remaining = deadline - now()
      if (remaining <= 0) {
        throw new StartupDeadlineError(
          `${label} did not become ready before the startup deadline (${number} attempts): ${message}`,
          { cause: error },
        )
      }
      const wait = Math.min(delay, remaining)
      log(
        `${label} not ready (attempt ${number}: ${message}); retrying in ${Math.ceil(wait / 1000)}s, ${Math.ceil(remaining / 1000)}s left before the startup deadline`,
      )
      await sleep(wait)
      delay = Math.min(delay * 2, MAX_DELAY_MS)
    }
  }
}
