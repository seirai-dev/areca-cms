import { PgDialect } from 'drizzle-orm/pg-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { hashToken } from '#/server/security/token-hash'

import {
  assertEmailMayRegister,
  assertPasswordSignupMayProceed,
} from './registration-gate'

// Rows for each query, in the order the gate runs them. `wheres` keeps each
// query's condition so a test can see the values it binds.
const queued = vi.hoisted(() => ({
  rows: [] as unknown[][],
  wheres: [] as unknown[],
}))

vi.mock('#/db', () => {
  const next = async () => queued.rows.shift() ?? []
  return {
    db: {
      select: () => ({
        from: () => ({
          limit: next,
          where: (condition: unknown) => {
            queued.wheres.push(condition)
            return { limit: next }
          },
        }),
      }),
    },
  }
})

const bootstrapped = [{ id: 'owner' }]
const invite = [{ id: 'invite-1' }]
const account = [{ id: 'existing-user' }]

async function refusalOf(promise: Promise<unknown>) {
  try {
    await promise
  } catch (error) {
    return error
  }
  throw new Error('expected the sign-up to be refused')
}

/** What a refused sign-up shows the caller: status, code and message. */
function answerOf(error: unknown) {
  const { statusCode, body } = error as { statusCode: number; body: unknown }
  return { statusCode, body }
}

describe('assertPasswordSignupMayProceed', () => {
  beforeEach(() => {
    queued.rows = []
    queued.wheres = []
  })

  it('matches the invitation by the hash of the token, never the raw token', async () => {
    queued.rows = [bootstrapped, [], invite]
    await assertPasswordSignupMayProceed('new@example.com', 'raw-token')
    const bound = new PgDialect().sqlToQuery(
      queued.wheres.at(-1) as Parameters<PgDialect['sqlToQuery']>[0],
    ).params
    expect(bound).toContain(hashToken('raw-token'))
    expect(bound).not.toContain('raw-token')
  })

  it('lets a sign-up through with a pending invitation and no account', async () => {
    queued.rows = [bootstrapped, [], invite]
    await expect(
      assertPasswordSignupMayProceed('New@Example.com', 'token'),
    ).resolves.toBeUndefined()
  })

  it('refuses when no invitation matches', async () => {
    queued.rows = [bootstrapped, [], []]
    await expect(
      assertPasswordSignupMayProceed('new@example.com', 'wrong'),
    ).rejects.toMatchObject({ body: { code: 'REGISTRATION_NOT_ALLOWED' } })
  })

  it('refuses existing accounts with the same answer as a missing invitation', async () => {
    queued.rows = [bootstrapped, account]
    const existing = await refusalOf(
      assertPasswordSignupMayProceed('taken@example.com', 'token'),
    )
    queued.rows = [bootstrapped, [], []]
    const missing = await refusalOf(
      assertPasswordSignupMayProceed('free@example.com', 'wrong'),
    )
    expect(answerOf(existing)).toEqual(answerOf(missing))
    expect(answerOf(existing).body).toMatchObject({
      code: 'REGISTRATION_NOT_ALLOWED',
    })
  })

  it('refuses without an invitation token and never looks the account up', async () => {
    queued.rows = [bootstrapped, account]
    await expect(
      assertPasswordSignupMayProceed('taken@example.com', undefined),
    ).rejects.toMatchObject({ body: { code: 'REGISTRATION_NOT_ALLOWED' } })
    expect(queued.rows).toHaveLength(2)
  })

  it('refuses an instance that has not been bootstrapped', async () => {
    queued.rows = [[]]
    await expect(
      assertPasswordSignupMayProceed('first@example.com', 'token'),
    ).rejects.toMatchObject({ body: { code: 'REGISTRATION_NOT_ALLOWED' } })
  })
})

describe('assertEmailMayRegister', () => {
  beforeEach(() => {
    queued.rows = []
  })

  it('lets a verified provider sign-in create a user with a pending invitation', async () => {
    queued.rows = [bootstrapped, [], invite]
    await expect(
      assertEmailMayRegister('invitee@example.com', {
        passwordSignup: false,
        emailVerified: true,
      }),
    ).resolves.toBeUndefined()
  })
})
