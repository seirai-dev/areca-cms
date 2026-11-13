import { Pool } from 'pg'

import { pool } from '#/db'
import { registerPool } from '#/db/pool-registry'
import { createSessionLock } from '#/db/session-lock'
import { createLogger } from '#/server/log'

// Waiting factor attempts must not occupy the data connections needed by
// Better Auth to finish the attempt that holds the lock.
const locks = new Pool({ ...pool.options, max: 4 })
locks.on('error', (err) =>
  createLogger('factor-lock').error('Factor lock failed', { err }),
)
registerPool('factor_lock', locks)
const withLock = createSessionLock(locks)

export function withFactorLock<T>(
  userId: string,
  run: () => Promise<T>,
): Promise<T> {
  return withLock(`local-factor:${userId}`, run)
}
