import { eq } from 'drizzle-orm'
import { afterAll, describe, expect, it, vi } from 'vitest'

import { db } from '#/db'
import { session, user } from '#/db/schema'
import { withRequestScope } from '#/server/http/request-scope.server'

import { localMfaVerifiedAt, recordLocalMfaForToken } from './local-mfa'

const hasDb = Boolean(process.env.DATABASE_URL)

describe.skipIf(!hasDb)('localMfaVerifiedAt memo', () => {
  const userId = crypto.randomUUID()
  const sessionId = crypto.randomUUID()
  const token = crypto.randomUUID()

  afterAll(async () => {
    await db.delete(user).where(eq(user.id, userId))
  })

  it('reads the proof once per request and again after a code was recorded', async () => {
    await db.insert(user).values({
      id: userId,
      name: 'Memo',
      email: `memo-${userId}@test.local`,
      emailVerified: true,
    })
    await db.insert(session).values({
      id: sessionId,
      userId,
      token,
      expiresAt: new Date(Date.now() + 3_600_000),
    })
    const principal = { session: { id: sessionId }, user: { id: userId } }

    await withRequestScope(async () => {
      const spy = vi.spyOn(db, 'select')
      try {
        expect(await localMfaVerifiedAt(principal)).toBeNull()
        expect(await localMfaVerifiedAt(principal)).toBeNull()
        expect(spy).toHaveBeenCalledTimes(1)
      } finally {
        spy.mockRestore()
      }
      await recordLocalMfaForToken(token)
      expect(await localMfaVerifiedAt(principal)).toBeInstanceOf(Date)
    })
  })
})
