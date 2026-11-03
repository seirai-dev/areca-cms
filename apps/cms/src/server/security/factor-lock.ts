import { AsyncLocalStorage } from 'node:async_hooks'
import { Pool } from 'pg'

import { pool } from '#/db'
import { registerPool } from '#/db/pool-registry'
import { createLogger } from '#/server/log'

// Waiting factor attempts must not occupy the data connections needed by
// Better Auth to finish the attempt that holds the lock.
const locks = new Pool({ ...pool.options, max: 4 })
locks.on('error', (err) =>
  createLogger('factor-lock').error('Factor lock failed', { err }),
)
registerPool('factor_lock', locks)
const held = new AsyncLocalStorage<string>()

export async function withFactorLock<T>(
  userId: string,
  run: () => Promise<T>,
): Promise<T> {
  if (held.getStore() === userId) return run()
  const connection = await locks.connect()
  let healthy = true
  const onError = () => {
    healthy = false
  }
  connection.on('error', onError)
  try {
    await connection.query('SELECT pg_advisory_lock(hashtextextended($1, 0))', [
      `local-factor:${userId}`,
    ])
    return await held.run(userId, run)
  } finally {
    try {
      await connection.query(
        'SELECT pg_advisory_unlock(hashtextextended($1, 0))',
        [`local-factor:${userId}`],
      )
    } catch {
      healthy = false
    }
    connection.removeListener('error', onError)
    connection.release(!healthy)
  }
}
