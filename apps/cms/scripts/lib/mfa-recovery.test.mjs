import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseMfaRecoveryArgs, resetMfaLockout } from './mfa-recovery.mjs'

test('operator recovery requires an explicit target and confirmation', () => {
  assert.throws(() => parseMfaRecoveryArgs(['--email', 'admin@example.com']))
  assert.equal(
    parseMfaRecoveryArgs(['--email', 'ADMIN@example.com', '--confirm']),
    'admin@example.com',
  )
})

test('operator recovery only clears failures and records an audit event', async () => {
  const queries = []
  const client = {
    query: async (sql, params) => {
      queries.push({ sql, params })
      return {
        rows: sql.startsWith('SELECT id')
          ? [{ id: 'admin-1', is_agency_admin: true }]
          : [],
      }
    },
  }
  assert.equal(await resetMfaLockout(client, 'admin@example.com'), 'admin-1')
  assert.equal(queries.at(-1).sql, 'COMMIT')
  assert.deepEqual(
    queries.find((query) => query.sql.startsWith('DELETE')).params,
    ['step-up-failures:admin-1'],
  )
  assert.ok(
    queries.some((query) =>
      query.sql.includes('security.factor_lockout_reset'),
    ),
  )
  assert.equal(
    queries.some((query) =>
      /UPDATE|DELETE FROM ("user"|two_factor|session)/i.test(query.sql),
    ),
    false,
  )
})

test('operator recovery refuses non-admin users and rolls back', async () => {
  const queries = []
  const client = {
    query: async (sql) => {
      queries.push(sql)
      return {
        rows: sql.startsWith('SELECT id')
          ? [{ id: 'editor-1', is_agency_admin: false }]
          : [],
      }
    },
  }
  await assert.rejects(
    resetMfaLockout(client, 'editor@example.com'),
    /Agency admin not found/,
  )
  assert.equal(queries.at(-1), 'ROLLBACK')
  assert.equal(
    queries.some((sql) => sql.startsWith('DELETE')),
    false,
  )
})
