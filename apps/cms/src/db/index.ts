import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'

import { env } from '#/env'
import { createLogger } from '#/server/log'

import { registerPool } from './pool-registry.ts'
import * as schema from './schema.ts'

const log = createLogger('db')

/**
 * Deadlines protect the request path and the worker from a stuck database:
 * - connectionTimeoutMillis: fail fast when the pool cannot get a connection
 * - statement_timeout: server cancels any single statement over the limit
 * - idle_in_transaction_session_timeout: a transaction left open (a crashed
 *   handler, a lost lease) cannot hold row locks forever
 * Operations that legitimately need longer should run in a transaction that
 * starts with `SET LOCAL statement_timeout = ...`. Migrations run in a separate
 * process (scripts/docker-entrypoint.mjs) and do not use this pool.
 */
export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: env.DB_POOL_MAX,
  connectionTimeoutMillis: env.DB_CONNECT_TIMEOUT_MS,
  statement_timeout: env.DB_STATEMENT_TIMEOUT_MS,
  idle_in_transaction_session_timeout: env.DB_IDLE_IN_TX_TIMEOUT_MS,
})
registerPool('main', pool)

// An idle client erroring (server restart, network drop) emits on the pool;
// without a listener Node would crash the process.
pool.on('error', (error) => {
  log.error('idle postgres client error', { err: error })
})

export const db = drizzle(pool, { schema })
