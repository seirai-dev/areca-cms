import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'

import { db } from '#/db'
import { auditLog, session } from '#/db/schema'

import { listUsers } from './user-directory.ts'
import { getUserDetail } from './user-access.ts'
import { makePerson, removePeople } from './account-fixtures.test-utils.ts'

const MINUTE = 60_000
const people: string[] = []

afterEach(async () => {
  await removePeople(people.splice(0))
})

async function person() {
  const row = await makePerson()
  people.push(row.id)
  return row
}

async function addSession(userId: string, updatedAt: Date) {
  const id = crypto.randomUUID()
  await db.insert(session).values({
    id,
    token: `token-${id}`,
    userId,
    expiresAt: new Date(updatedAt.getTime() + 30 * 24 * 60 * MINUTE),
    createdAt: updatedAt,
    updatedAt,
  })
  return id
}

async function addSignIn(userId: string, at: Date) {
  await db.insert(auditLog).values({
    actorId: userId,
    action: 'user.sign_in',
    targetType: 'user',
    targetId: userId,
    createdAt: at,
  })
}

/**
 * The people list and the person page must give the same "last active" for
 * one person. Each case is checked through both reads.
 */
async function lastActiveFromBothReads(userId: string) {
  const list = (await listUsers()).find((row) => row.id === userId)
  const detail = await getUserDetail(userId)
  return {
    list: list?.lastActiveAt?.getTime() ?? null,
    detail: detail.lastActiveAt?.getTime() ?? null,
  }
}

describe('last active agrees between the people list and the person page', () => {
  it('uses the newest session while a session is active', async () => {
    const row = await person()
    const seen = new Date(Date.now() - 15 * MINUTE)
    await addSession(row.id, seen)

    const read = await lastActiveFromBothReads(row.id)
    expect(read.list).toBe(seen.getTime())
    expect(read.detail).toBe(seen.getTime())
  })

  it('keeps the last sign-in after every session has ended', async () => {
    const row = await person()
    const signedIn = new Date(Date.now() - 3 * 60 * MINUTE)
    const sessionSeen = new Date(Date.now() - 2 * 60 * MINUTE)
    await addSignIn(row.id, signedIn)
    const sessionId = await addSession(row.id, sessionSeen)
    await db.delete(session).where(eq(session.id, sessionId))

    const read = await lastActiveFromBothReads(row.id)
    expect(read.list).toBe(signedIn.getTime())
    expect(read.detail).toBe(signedIn.getTime())
  })

  it('takes the later of a sign-in and a newer session update', async () => {
    const row = await person()
    const signedIn = new Date(Date.now() - 3 * 60 * MINUTE)
    const seen = new Date(Date.now() - 20 * MINUTE)
    await addSignIn(row.id, signedIn)
    await addSession(row.id, seen)

    const read = await lastActiveFromBothReads(row.id)
    expect(read.list).toBe(seen.getTime())
    expect(read.detail).toBe(seen.getTime())
  })

  it('is empty for someone who has never signed in', async () => {
    const row = await person()

    const read = await lastActiveFromBothReads(row.id)
    expect(read.list).toBeNull()
    expect(read.detail).toBeNull()
  })
})
