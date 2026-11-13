import type * as EnvModule from '#/env'

import { eq } from 'drizzle-orm'
import { afterAll, describe, expect, it, vi } from 'vitest'

import { db } from '#/db'
import { verification } from '#/db/schema'
import { securityErrorCode } from '#/lib/security-errors'

import {
  owesLocalMfa,
  requireAdminLocalMfa,
  requireLocalMfa,
  requireMemberLocalMfa,
} from './local-mfa'

vi.mock('#/env', async (original) => {
  const actual = await original<typeof EnvModule>()
  return { env: { ...actual.env, ADMIN_MFA_REQUIRED: false } }
})

const hasDb = Boolean(process.env.DATABASE_URL)

async function rejection(promise: Promise<unknown>) {
  try {
    await promise
  } catch (error) {
    return error
  }
  throw new Error('expected a rejection')
}

describe.skipIf(!hasDb)('agency admins with ADMIN_MFA_REQUIRED=false', () => {
  const proofs: string[] = []

  afterAll(async () => {
    for (const id of proofs)
      await db.delete(verification).where(eq(verification.id, id))
  })

  function admin(twoFactorEnabled: boolean) {
    return {
      session: { id: crypto.randomUUID() },
      user: { id: crypto.randomUUID(), isAgencyAdmin: true, twoFactorEnabled },
    }
  }

  it('still asks an admin with two-factor on for a code once per session', async () => {
    const principal = admin(true)
    expect(await owesLocalMfa(principal)).toBe(true)
    for (const check of [
      requireMemberLocalMfa,
      requireAdminLocalMfa,
      requireLocalMfa,
    ]) {
      expect(securityErrorCode(await rejection(check(principal)))).toBe(
        'MFA_REQUIRED',
      )
    }

    const id = `local-mfa:${principal.session.id}`
    proofs.push(id)
    await db.insert(verification).values({
      id,
      identifier: id,
      value: principal.user.id,
      expiresAt: new Date(Date.now() + 60_000),
    })
    expect(await owesLocalMfa(principal)).toBe(false)
    await expect(requireLocalMfa(principal)).resolves.toBeUndefined()
  })

  it('does not require two-factor of an admin who has not turned it on', async () => {
    await expect(requireLocalMfa(admin(false))).resolves.toBeUndefined()
  })
})
