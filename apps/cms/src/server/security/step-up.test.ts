import { eq, like } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const verifyTOTP = vi.hoisted(() => vi.fn())
vi.mock('#/lib/auth', () => ({ auth: { api: { verifyTOTP } } }))

import { db } from '#/db'
import { verification } from '#/db/schema'
import { securityErrorCode } from '#/lib/security-errors'

import {
  assertFreshSession,
  clearStepUpFailures,
  isStepUpLocked,
  recordStepUp,
  recordStepUpFailure,
} from './step-up.ts'
import { verifyStepUp } from './verify-step-up.ts'

const hasDb = Boolean(process.env.DATABASE_URL)

describe.skipIf(!hasDb)('step-up', () => {
  const run = crypto.randomUUID()
  const userId = `user-${run}`
  const sessionId = `session-${run}`
  const session = (createdAt: Date, twoFactorEnabled = true) => ({
    session: { id: sessionId, createdAt },
    user: { id: userId, twoFactorEnabled },
  })
  const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000)

  async function cleanup() {
    await db
      .delete(verification)
      .where(like(verification.identifier, `%${run}`))
  }
  beforeEach(async () => {
    verifyTOTP.mockReset()
    await cleanup()
  })
  afterEach(cleanup)

  async function rejection(promise: Promise<unknown>) {
    try {
      await promise
    } catch (error) {
      return error
    }
    throw new Error('expected a rejection')
  }

  it('passes for a session created in the last ten minutes', async () => {
    await expect(assertFreshSession(session(minutesAgo(2)))).resolves.toBe(
      undefined,
    )
  })

  it('asks for REAUTH_REQUIRED once the session is older than ten minutes', async () => {
    const error = await rejection(assertFreshSession(session(minutesAgo(11))))
    expect(securityErrorCode(error)).toBe('REAUTH_REQUIRED')
  })

  it('passes again after a re-verification is recorded', async () => {
    await recordStepUp(sessionId, userId)
    await expect(assertFreshSession(session(minutesAgo(120)))).resolves.toBe(
      undefined,
    )
  })

  it('expires the re-verification after ten minutes', async () => {
    await recordStepUp(sessionId, userId, minutesAgo(11))
    const error = await rejection(assertFreshSession(session(minutesAgo(120))))
    expect(securityErrorCode(error)).toBe('REAUTH_REQUIRED')
  })

  it('keeps one marker per session', async () => {
    await recordStepUp(sessionId, userId)
    await recordStepUp(sessionId, userId)
    const rows = await db
      .select()
      .from(verification)
      .where(eq(verification.identifier, `step-up:${sessionId}`))
    expect(rows).toHaveLength(1)
  })

  it('does not trap users who have no second factor to enter', async () => {
    await expect(
      assertFreshSession(session(minutesAgo(120), false)),
    ).resolves.toBe(undefined)
  })

  it('locks after five wrong codes and unlocks when cleared', async () => {
    for (let i = 0; i < 4; i++) await recordStepUpFailure(userId)
    expect(await isStepUpLocked(userId)).toBe(false)
    await recordStepUpFailure(userId)
    expect(await isStepUpLocked(userId)).toBe(true)
    await clearStepUpFailures(userId)
    expect(await isStepUpLocked(userId)).toBe(false)
  })

  describe('verifyStepUp', () => {
    const input = (code = '123 456') => ({
      session: { id: sessionId },
      userId,
      code,
      headers: new Headers(),
    })

    it('verifies the code through Better Auth and marks the session fresh', async () => {
      verifyTOTP.mockResolvedValue({ token: 't' })
      await expect(verifyStepUp(input())).resolves.toEqual({ ok: true })
      expect(verifyTOTP).toHaveBeenCalledWith(
        expect.objectContaining({ body: { code: '123456' } }),
      )
      await expect(assertFreshSession(session(minutesAgo(120)))).resolves.toBe(
        undefined,
      )
    })

    it('rejects a wrong code, records it and leaves the session stale', async () => {
      verifyTOTP.mockRejectedValue(new Error('INVALID_CODE'))
      await expect(verifyStepUp(input())).rejects.toThrow('did not work')
      const error = await rejection(
        assertFreshSession(session(minutesAgo(120))),
      )
      expect(securityErrorCode(error)).toBe('REAUTH_REQUIRED')
    })

    it('stops calling Better Auth once the user is locked out', async () => {
      verifyTOTP.mockRejectedValue(new Error('INVALID_CODE'))
      for (let i = 0; i < 5; i++) {
        await expect(verifyStepUp(input())).rejects.toThrow()
      }
      verifyTOTP.mockClear()
      verifyTOTP.mockResolvedValue({ token: 't' })
      await expect(verifyStepUp(input())).rejects.toThrow('Too many')
      expect(verifyTOTP).not.toHaveBeenCalled()
    })
  })
})
