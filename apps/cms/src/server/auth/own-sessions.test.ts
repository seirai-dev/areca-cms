import { and, eq } from 'drizzle-orm'
import { hashPassword } from 'better-auth/crypto'
import { describe, expect, it } from 'vitest'

import { db } from '#/db'
import { account, auditLog, session, user } from '#/db/schema'
import { auth } from '#/lib/auth'
import { ForbiddenError, NotFoundError } from '#/server/content/errors'

import { listOwnSessions, revocableOwnSessionToken } from './own-sessions'

const DAY = 24 * 60 * 60 * 1000

async function makeUser() {
  const id = crypto.randomUUID()
  const rows = await db
    .insert(user)
    .values({ id, email: `${id}@sessions.test`, name: 'Sessions' })
    .returning()
  const row = rows.at(0)
  if (!row) throw new Error('user insert failed')
  return row
}

async function addSession(
  userId: string,
  overrides: Partial<typeof session.$inferInsert> = {},
) {
  const id = crypto.randomUUID()
  const rows = await db
    .insert(session)
    .values({
      id,
      userId,
      token: `token-${id}`,
      expiresAt: new Date(Date.now() + 7 * DAY),
      userAgent: 'Mozilla/5.0 (Macintosh) Firefox/120.0',
      ipAddress: '203.0.113.7',
      ...overrides,
    })
    .returning()
  const row = rows.at(0)
  if (!row) throw new Error('session insert failed')
  return row
}

/** Signs in through Better Auth and returns the Cookie header for that session. */
async function signIn(email: string, password: string) {
  const { headers } = await auth.api.signInEmail({
    body: { email, password },
    returnHeaders: true,
  })
  return new Headers({
    cookie: headers
      .getSetCookie()
      .map((cookie) => cookie.split(';')[0])
      .join('; '),
  })
}

describe('own sessions', () => {
  it('lists only the caller live sessions, most recent first, with no token', async () => {
    const me = await makeUser()
    const other = await makeUser()
    const current = await addSession(me.id, {
      updatedAt: new Date(Date.now() - 2 * DAY),
    })
    const recent = await addSession(me.id, { updatedAt: new Date() })
    await addSession(me.id, { expiresAt: new Date(Date.now() - DAY) })
    await addSession(other.id)

    const list = await listOwnSessions(me.id, current.id)

    expect(list.map((s) => s.id)).toEqual([recent.id, current.id])
    expect(list.find((s) => s.id === current.id)?.current).toBe(true)
    expect(list.find((s) => s.id === recent.id)?.current).toBe(false)
    expect(list[0]).toMatchObject({
      userAgent: 'Mozilla/5.0 (Macintosh) Firefox/120.0',
      ipAddress: '203.0.113.7',
    })
    expect(Object.keys(list[0] ?? {}).sort()).toEqual(
      [
        'createdAt',
        'current',
        'expiresAt',
        'id',
        'ipAddress',
        'updatedAt',
        'userAgent',
      ].sort(),
    )
    expect(JSON.stringify(list)).not.toContain('token-')
  })

  it('refuses to hand out the token of the current session', async () => {
    const me = await makeUser()
    const current = await addSession(me.id)

    await expect(
      revocableOwnSessionToken(me.id, current.id, current.id),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it("answers NotFound for another user's session, an expired one, or an unknown id", async () => {
    const me = await makeUser()
    const other = await makeUser()
    const current = await addSession(me.id)
    const theirs = await addSession(other.id)
    const expired = await addSession(me.id, {
      expiresAt: new Date(Date.now() - DAY),
    })

    for (const sessionId of [theirs.id, expired.id, 'no-such-session']) {
      await expect(
        revocableOwnSessionToken(me.id, current.id, sessionId),
      ).rejects.toBeInstanceOf(NotFoundError)
    }
  })

  it('returns the token of another live session of the caller', async () => {
    const me = await makeUser()
    const current = await addSession(me.id)
    const other = await addSession(me.id)

    await expect(
      revocableOwnSessionToken(me.id, current.id, other.id),
    ).resolves.toBe(other.token)
  })

  describe('revoking through Better Auth', () => {
    const password = 'password123'

    async function signedInPerson() {
      const person = await makeUser()
      await db.insert(account).values({
        id: crypto.randomUUID(),
        accountId: person.id,
        providerId: 'credential',
        userId: person.id,
        password: await hashPassword(password),
      })
      return person
    }

    it('ends the chosen session at once and audits it exactly once', async () => {
      const person = await signedInPerson()
      const otherHeaders = await signIn(person.email, password)
      const callerHeaders = await signIn(person.email, password)

      const caller = await auth.api.getSession({ headers: callerHeaders })
      expect(caller).not.toBeNull()
      const callerSessionId = caller!.session.id
      const otherSession = (
        await listOwnSessions(person.id, callerSessionId)
      ).find((s) => !s.current)
      expect(otherSession).toBeDefined()
      expect(
        await auth.api.getSession({ headers: otherHeaders }),
      ).not.toBeNull()

      const token = await revocableOwnSessionToken(
        person.id,
        callerSessionId,
        otherSession!.id,
      )
      await auth.api.revokeSession({ body: { token }, headers: callerHeaders })

      expect(await auth.api.getSession({ headers: otherHeaders })).toBeNull()
      expect(
        await auth.api.getSession({ headers: callerHeaders }),
      ).not.toBeNull()
      const audits = await db
        .select()
        .from(auditLog)
        .where(
          and(
            eq(auditLog.actorId, person.id),
            eq(auditLog.action, 'session.revoke'),
          ),
        )
      expect(audits).toHaveLength(1)
      expect(audits[0]).toMatchObject({
        targetType: 'session',
        targetId: otherSession!.id,
      })
      expect(JSON.stringify(audits[0]?.meta)).not.toContain(token)
    })

    it('signs out every other session, keeps the caller, and audits once', async () => {
      const person = await signedInPerson()
      const firstHeaders = await signIn(person.email, password)
      const secondHeaders = await signIn(person.email, password)
      const callerHeaders = await signIn(person.email, password)

      await auth.api.revokeOtherSessions({ headers: callerHeaders })

      expect(await auth.api.getSession({ headers: firstHeaders })).toBeNull()
      expect(await auth.api.getSession({ headers: secondHeaders })).toBeNull()
      expect(
        await auth.api.getSession({ headers: callerHeaders }),
      ).not.toBeNull()
      const audits = await db
        .select()
        .from(auditLog)
        .where(
          and(
            eq(auditLog.actorId, person.id),
            eq(auditLog.action, 'session.revoke_others'),
          ),
        )
      expect(audits).toHaveLength(1)
    })
  })
})
