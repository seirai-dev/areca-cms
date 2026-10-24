/* eslint-disable @typescript-eslint/no-unnecessary-condition -- row lookups after .select() are checked defensively */
import { and, eq } from 'drizzle-orm'
import { hashPassword } from 'better-auth/crypto'
import { afterEach, describe, expect, it } from 'vitest'

import { db } from '#/db'
import {
  account,
  auditLog,
  emailOutbox,
  invitation,
  membership,
  session,
} from '#/db/schema'
import { ConflictError } from '#/server/content/errors'

import {
  bulkAddUsersToClients,
  getUserDetail,
  setUserClientAccess,
} from './user-access.ts'
import { blockUser } from './users.ts'
import {
  join,
  makeClient,
  makePerson,
  removeClients,
  removePeople,
} from './account-fixtures.test-utils.ts'

const hasDb = Boolean(process.env.DATABASE_URL)

const people: string[] = []
const clients: string[] = []

afterEach(async () => {
  await removePeople(people.splice(0))
  await removeClients(clients.splice(0))
})

async function person(input: Parameters<typeof makePerson>[0] = {}) {
  const row = await makePerson(input)
  people.push(row.id)
  return row
}

async function client(label: string) {
  const row = await makeClient(label)
  clients.push(row.id)
  return row
}

async function roleIn(userId: string, organizationId: string) {
  const [row] = await db
    .select({ role: membership.role })
    .from(membership)
    .where(
      and(
        eq(membership.userId, userId),
        eq(membership.organizationId, organizationId),
      ),
    )
  return row?.role ?? null
}

async function noticesOf(userId: string, kind: string) {
  return db
    .select()
    .from(emailOutbox)
    .where(and(eq(emailOutbox.userId, userId), eq(emailOutbox.kind, kind)))
}

describe.skipIf(!hasDb)('staged client access', () => {
  it('adds, changes and removes in one save, returns the counts, and emails once for the additions', async () => {
    const admin = await person({ admin: true, name: 'Owen Admin' })
    const p = await person({ name: 'Pia Person' })
    const acme = await client('Acme Works')
    const beta = await client('Beta Labs')
    const gamma = await client('Gamma Studio')
    const delta = await client('Delta Yard')
    await join(p.id, acme.id, 'editor')
    await join(p.id, gamma.id, 'editor')
    // A second owner on Acme, so Acme's role can change.
    const spare = await person()
    await join(spare.id, acme.id, 'owner')

    const result = await setUserClientAccess({
      actorId: admin.id,
      userId: p.id,
      add: [
        { organizationId: beta.id, role: 'owner' },
        { organizationId: delta.id, role: 'editor' },
      ],
      change: [{ organizationId: acme.id, role: 'owner' }],
      remove: [gamma.id],
    })

    expect(result).toEqual({ added: 2, changed: 1, removed: 1 })
    expect(await roleIn(p.id, beta.id)).toBe('owner')
    expect(await roleIn(p.id, delta.id)).toBe('editor')
    expect(await roleIn(p.id, acme.id)).toBe('owner')
    expect(await roleIn(p.id, gamma.id)).toBeNull()

    // One email for both additions, listing both clients.
    const added = await noticesOf(p.id, 'membership_added')
    expect(added).toHaveLength(1)
    expect(added[0]?.params).toEqual(
      expect.objectContaining({
        actorName: 'Owen Admin',
        orgs: [
          { name: 'Beta Labs', role: 'owner' },
          { name: 'Delta Yard', role: 'editor' },
        ],
      }),
    )
    // The change and the removal keep their own existing notices.
    expect(await noticesOf(p.id, 'membership_role_changed')).toHaveLength(1)
    expect(await noticesOf(p.id, 'membership_removed')).toHaveLength(1)

    // Audit: a direct add per new client, with the role.
    const adds = await db
      .select()
      .from(auditLog)
      .where(
        and(eq(auditLog.action, 'member.add'), eq(auditLog.actorId, admin.id)),
      )
    const forPia = adds.filter(
      (row) => (row.meta as { userId?: string } | null)?.userId === p.id,
    )
    expect(forPia.map((row) => row.organizationId).sort()).toEqual(
      [beta.id, delta.id].sort(),
    )
    expect(forPia[0]?.meta).toMatchObject({ direct: true, email: p.email })
  })

  it('no additions means no membership_added email', async () => {
    const admin = await person({ admin: true })
    const p = await person()
    const acme = await client('Acme Works')
    await join(p.id, acme.id, 'editor')
    await join(admin.id, acme.id, 'owner')

    await setUserClientAccess({
      actorId: admin.id,
      userId: p.id,
      add: [],
      change: [{ organizationId: acme.id, role: 'owner' }],
      remove: [],
    })

    expect(await noticesOf(p.id, 'membership_added')).toHaveLength(0)
  })

  it('refuses to change the only owner of a client and names it; nothing in the save is applied', async () => {
    const admin = await person({ admin: true })
    const p = await person()
    const sole = await client('Sole Owner Co')
    const fresh = await client('Fresh Client')
    await join(p.id, sole.id, 'owner')

    await expect(
      setUserClientAccess({
        actorId: admin.id,
        userId: p.id,
        add: [{ organizationId: fresh.id, role: 'editor' }],
        change: [{ organizationId: sole.id, role: 'editor' }],
        remove: [],
      }),
    ).rejects.toThrow('Cannot demote the last owner of Sole Owner Co')

    // The add in the same save was rolled back with it.
    expect(await roleIn(p.id, fresh.id)).toBeNull()
    expect(await roleIn(p.id, sole.id)).toBe('owner')
  })

  it('refuses to remove the only owner of a client and names it', async () => {
    const admin = await person({ admin: true })
    const p = await person()
    const sole = await client('Lonely Owners')
    await join(p.id, sole.id, 'owner')

    await expect(
      setUserClientAccess({
        actorId: admin.id,
        userId: p.id,
        add: [],
        change: [],
        remove: [sole.id],
      }),
    ).rejects.toThrow('Cannot remove the last owner of Lonely Owners')
    expect(await roleIn(p.id, sole.id)).toBe('owner')
  })

  it('refuses to add someone to a client they are already in, and names the client', async () => {
    const admin = await person({ admin: true })
    const p = await person()
    const acme = await client('Acme Works')
    await join(p.id, acme.id, 'editor')

    await expect(
      setUserClientAccess({
        actorId: admin.id,
        userId: p.id,
        add: [{ organizationId: acme.id, role: 'owner' }],
        change: [],
        remove: [],
      }),
    ).rejects.toThrow('Already a member of Acme Works.')
    expect(await roleIn(p.id, acme.id)).toBe('editor')
  })

  it('refuses one client appearing twice in a save', async () => {
    const admin = await person({ admin: true })
    const p = await person()
    const acme = await client('Acme Works')
    await join(p.id, acme.id, 'editor')

    await expect(
      setUserClientAccess({
        actorId: admin.id,
        userId: p.id,
        add: [],
        change: [{ organizationId: acme.id, role: 'owner' }],
        remove: [acme.id],
      }),
    ).rejects.toBeInstanceOf(ConflictError)
    expect(await roleIn(p.id, acme.id)).toBe('editor')
  })

  it('bulk add gives each person only the clients they lack, and skips people with nothing to add', async () => {
    const admin = await person({ admin: true })
    const alreadyIn = await person()
    const fresh = await person()
    const acme = await client('Acme Works')
    const beta = await client('Beta Labs')
    await join(alreadyIn.id, acme.id, 'editor')
    await join(alreadyIn.id, beta.id, 'editor')

    const result = await bulkAddUsersToClients({
      actorId: admin.id,
      userIds: [admin.id, alreadyIn.id, fresh.id],
      organizationIds: [acme.id, beta.id],
      role: 'editor',
    })

    expect(result.done).toEqual([fresh.id])
    expect(
      result.skipped.map((row) => [row.userId, row.reason]).sort(),
    ).toEqual(
      [
        [admin.id, 'self'],
        [alreadyIn.id, 'already_member'],
      ].sort(),
    )
    expect(await roleIn(fresh.id, acme.id)).toBe('editor')
    expect(await roleIn(fresh.id, beta.id)).toBe('editor')
  })
})

describe.skipIf(!hasDb)('the person page', () => {
  it('shows client roles, which membership is their only-owner seat, sign-in state and pending invitations', async () => {
    const admin = await person({ admin: true })
    const p = await person({ name: 'Pat Profile' })
    const solo = await client('Solo Owner Ltd')
    const shared = await client('Shared Owners Ltd')
    await join(p.id, solo.id, 'owner')
    await join(p.id, shared.id, 'editor')
    const other = await person()
    await join(other.id, shared.id, 'owner')
    await db.insert(account).values({
      id: crypto.randomUUID(),
      accountId: p.id,
      providerId: 'credential',
      userId: p.id,
      password: await hashPassword('a password of some length'),
    })
    await db.insert(session).values({
      id: crypto.randomUUID(),
      token: `t-${crypto.randomUUID()}`,
      userId: p.id,
      expiresAt: new Date(Date.now() + 60_000),
    })
    await db.insert(invitation).values({
      email: p.email.toLowerCase(),
      organizationId: shared.id,
      role: 'editor',
      tokenHash: `h-${crypto.randomUUID()}`,
      expiresAt: new Date(Date.now() + 60_000),
    })
    await blockUser({ actorId: admin.id, userId: other.id, reason: 'x' })
    const detail = await getUserDetail(p.id)

    expect(detail).toMatchObject({
      name: 'Pat Profile',
      hasPassword: true,
      activeSessions: 1,
      blocked: null,
    })
    expect(detail.lastActiveAt).toBeInstanceOf(Date)
    const byName = Object.fromEntries(
      detail.memberships.map((row) => [row.organizationName, row]),
    )
    expect(byName['Solo Owner Ltd']).toMatchObject({
      role: 'owner',
      isOnlyOwner: true,
    })
    expect(byName['Shared Owners Ltd']).toMatchObject({
      role: 'editor',
      isOnlyOwner: false,
    })
    expect(detail.pendingInvitations).toEqual([
      expect.objectContaining({
        organizationName: 'Shared Owners Ltd',
        role: 'editor',
      }),
    ])
  })

  it('shows who blocked the person and why, to agency admins', async () => {
    const admin = await person({ admin: true, name: 'Eva Admin' })
    const p = await person()
    await blockUser({
      actorId: admin.id,
      userId: p.id,
      reason: 'Contract ended',
    })

    const detail = await getUserDetail(p.id)

    expect(detail.blocked).toMatchObject({
      byName: 'Eva Admin',
      reason: 'Contract ended',
    })
    expect(detail.hasPassword).toBe(false)
  })
})
