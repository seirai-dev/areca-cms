import { AsyncLocalStorage } from 'node:async_hooks'
import type { Pool } from 'pg'

/**
 * Returns `withLock(key, run)`: runs `run` while holding a Postgres session
 * advisory lock on `key`, taken on a connection from `locks` (a small pool of
 * its own, so waiters cannot exhaust the data pool the holder needs). Nested
 * calls for the same key in the same async context run without locking again.
 * A connection error during `run` fails the call. The lock is released only
 * if it was taken, and a connection in an unknown state is discarded.
 */
export function createSessionLock(locks: Pick<Pool, 'connect'>) {
  const held = new AsyncLocalStorage<string>()
  return async function withLock<T>(
    key: string,
    run: () => Promise<T>,
  ): Promise<T> {
    if (held.getStore() === key) return run()
    const connection = await locks.connect()
    let acquired = false
    let healthy = true
    let connectionError: Error | undefined
    const onError = (error: Error) => {
      healthy = false
      connectionError = error
    }
    connection.on('error', onError)
    try {
      await connection.query(
        'SELECT pg_advisory_lock(hashtextextended($1, 0))',
        [key],
      )
      acquired = true
      const result = await held.run(key, run)
      if (connectionError) throw connectionError
      return result
    } finally {
      if (acquired) {
        try {
          await connection.query(
            'SELECT pg_advisory_unlock(hashtextextended($1, 0))',
            [key],
          )
        } catch {
          healthy = false
        }
      } else healthy = false
      connection.removeListener('error', onError)
      connection.release(!healthy)
    }
  }
}
