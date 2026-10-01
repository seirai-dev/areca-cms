import { test } from 'node:test'
import assert from 'node:assert/strict'
import { withMigrationLock, MIGRATION_LOCK_ID } from './migration-lock.mjs'

// In-memory stand-in for PostgreSQL's advisory lock table, shared by clients.
function fakePostgres() {
  let holder = null
  const calls = []
  let nextId = 0
  return {
    calls,
    pool: {
      async connect() {
        const id = ++nextId
        return {
          async query(sql, params) {
            calls.push({ id, sql, params })
            assert.deepEqual(params, [MIGRATION_LOCK_ID])
            if (sql.includes('pg_try_advisory_lock')) {
              if (holder === null || holder === id) {
                holder = id
                return { rows: [{ locked: true }] }
              }
              return { rows: [{ locked: false }] }
            }
            if (sql.includes('pg_advisory_unlock')) {
              if (holder === id) holder = null
              return { rows: [{ pg_advisory_unlock: true }] }
            }
            throw new Error(`unexpected sql ${sql}`)
          },
          release() {
            calls.push({ id, released: true })
          },
        }
      },
    },
  }
}

const quiet = { log: () => {}, pollMs: 5 }

test('runs fn under the lock, then unlocks and releases', async () => {
  const pg = fakePostgres()
  const result = await withMigrationLock(pg.pool, async () => 'done', quiet)
  assert.equal(result, 'done')
  assert.deepEqual(
    pg.calls.map((c) => (c.released ? 'release' : c.sql.split('(')[0].trim())),
    ['select pg_try_advisory_lock', 'select pg_advisory_unlock', 'release'],
  )
})

test('concurrent runs never overlap', async () => {
  const pg = fakePostgres()
  let active = 0
  let peak = 0
  let ran = 0
  const work = async () => {
    active += 1
    peak = Math.max(peak, active)
    await new Promise((resolve) => setTimeout(resolve, 20))
    active -= 1
    ran += 1
  }
  await Promise.all(
    [1, 2, 3].map(() => withMigrationLock(pg.pool, work, quiet)),
  )
  assert.equal(ran, 3)
  assert.equal(peak, 1)
})

test('waiters announce once', async () => {
  const pg = fakePostgres()
  const messages = []
  const log = (m) => messages.push(m)
  await Promise.all([
    withMigrationLock(pg.pool, () => new Promise((r) => setTimeout(r, 30)), {
      pollMs: 5,
      log,
    }),
    withMigrationLock(pg.pool, async () => {}, { pollMs: 5, log }),
  ])
  assert.equal(messages.length, 1)
})

test('releases the lock when fn throws', async () => {
  const pg = fakePostgres()
  await assert.rejects(
    withMigrationLock(
      pg.pool,
      async () => {
        throw new Error('boom')
      },
      quiet,
    ),
    /boom/,
  )
  assert.equal(
    await withMigrationLock(pg.pool, async () => 'next', quiet),
    'next',
  )
})

test('times out when the lock is never released', async () => {
  const pg = fakePostgres()
  const holder = await pg.pool.connect()
  await holder.query('select pg_try_advisory_lock($1::bigint)', [
    MIGRATION_LOCK_ID,
  ])
  let ran = false
  await assert.rejects(
    withMigrationLock(pg.pool, async () => (ran = true), {
      ...quiet,
      timeoutMs: 30,
    }),
    /Timed out/,
  )
  assert.equal(ran, false)
  // A timed-out waiter must not release a lock it never held.
  assert.equal(
    pg.calls.some((c) => c.id === 2 && c.sql?.includes('unlock')),
    false,
  )
})
