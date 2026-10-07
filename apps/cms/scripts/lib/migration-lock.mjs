// Serialises database migrations across replicas with a PostgreSQL session
// advisory lock. The lock lives on one dedicated connection, so it is released
// when fn finishes or, if the process dies, when that connection drops.

// ASCII "ARECA" as a bigint; unique to this application's migrations.
export const MIGRATION_LOCK_ID = '280553145153'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * @param {{ connect(): Promise<{ query(sql: string, params?: unknown[]): Promise<{ rows: any[] }>, release(): void }> }} pool
 * @param {() => Promise<T>} fn runs while holding the lock
 * @returns {Promise<T>}
 * @template T
 */
export async function withMigrationLock(
  pool,
  fn,
  { pollMs = 1000, timeoutMs = 10 * 60 * 1000, log = console.log } = {},
) {
  const client = await pool.connect()
  let locked = false
  try {
    const deadline = Date.now() + timeoutMs
    let announced = false
    for (;;) {
      const { rows } = await client.query(
        'select pg_try_advisory_lock($1::bigint) as locked',
        [MIGRATION_LOCK_ID],
      )
      if (rows[0].locked === true) {
        locked = true
        break
      }
      if (Date.now() >= deadline) {
        throw new Error(
          `Timed out after ${Math.round(timeoutMs / 1000)}s waiting for another instance to finish database migrations`,
        )
      }
      if (!announced) {
        log('another instance is running database migrations; waiting')
        announced = true
      }
      await sleep(pollMs)
    }
    return await fn()
  } finally {
    try {
      if (locked) {
        await client.query('select pg_advisory_unlock($1::bigint)', [
          MIGRATION_LOCK_ID,
        ])
      }
      client.release()
    } catch (error) {
      // A broken connection already dropped the lock; discard it.
      client.release(error instanceof Error ? error : new Error(String(error)))
    }
  }
}
