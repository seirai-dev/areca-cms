import type * as AdminRoster from './agency-admin-roster.ts'

import { and, eq, inArray, isNull } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { db } from '#/db'
import {
  auditLog,
  emailOutbox,
  invitation,
  mcpKey,
  membership,
  notification,
  session,
  twoFactor,
  user,
  verification,
} from '#/db/schema'
import { auth } from '#/lib/auth'
import { ConflictError } from '#/server/content/errors'
import { deliverPasswordReset } from '#/server/mail/account-emails'
import { cancelAllQueuedNotificationEmails } from '#/server/mail/outbox'
import { notifyStrict } from '#/server/notifications/notify'
import { notificationStillEligible } from '#/server/notifications/eligibility'
import { generateMcpKey, resolveMcpActorResult } from '#/server/mcp/keys'
import { hashedVerificationIdentifier } from '#/server/security/verification-identifiers'

import { LastAgencyAdminError } from './agency-admin-roster.ts'
import { listPendingInvitations } from './invitations.ts'
import { listUsers } from './user-directory.ts'
import { setAgencyAdmin } from './agency-admins.ts'
import {
  blockUser,
  bulkBlockUsers,
  deleteUser,
  renameUser,
  resetTwoFactor,
  searchPeople,
  signOutEverywhere,
  unblockUser,
} from './users.ts'
import {
  createTestSite,
  join,
  makeClient,
  makePerson,
  removeClients,
  removePeople,
} from './account-fixtures.test-utils.ts'

/** When set, the active-admin count only sees these admins (see fixtures). */
const scope = vi.hoisted(() => ({ ids: null as string[] | null }))

vi.mock('./agency-admin-roster.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof AdminRoster>()
  const { scopedActiveAdminCount } =
    await import('./account-fixtures.test-utils.ts')
  return {
    ...actual,
    countActiveAgencyAdmins: (
      tx: Parameters<typeof actual.countActiveAgencyAdmins>[0],
    ) =>
      scope.ids
        ? scopedActiveAdminCount(tx, scope.ids)
        : actual.countActiveAgencyAdmins(tx),
  }
})

const hasDb = Boolean(process.env.DATABASE_URL)

const people: string[] = []
const clients: string[] = []

afterEach(async () => {
  scope.ids = null
  await removePeople(people.splice(0))
  await removeClients(clients.splice(0))
})

async function person(input: Parameters<typeof makePerson>[0] = {}) {
  const row = await makePerson(input)
  people.push(row.id)
  return row
}

async function client(label?: string) {
  const row = await makeClient(label)
  clients.push(row.id)
  return row
}

async function sessionsOf(userId: string) {
  return db.select().from(session).where(eq(session.userId, userId))
}

/** A live session, created the way sign-in creates one. */
async function signIn(userId: string) {
  const ctx = await auth.$context
  return ctx.internalAdapter.createSession(userId)
}

/** A queued notification email for a person, as the fan-out leaves it. */
async function queuedNotice(userId: string) {
  const row = (
    await db
      .insert(emailOutbox)
      .values({
        kind: 'notification',
        notificationId: crypto.randomUUID(),
        toAddress: `queued-${userId}@areca.test`,
        userId,
        subject: 'Live',
        template: 'notification',
        params: { userId },
        locale: 'en',
        status: 'queued',
      })
      .returning()
  ).at(0)
  if (!row) throw new Error('fixture failed')
  return row
}

describe.skipIf(!hasDb)('blocking a person', () => {
  it('ends every session and refuses new sign-ins with ACCOUNT_BLOCKED', async () => {
    const admin = await person({ admin: true })
    const target = await person()
    await signIn(target.id)
    await signIn(target.id)
    expect(await sessionsOf(target.id)).toHaveLength(2)

    await blockUser({ actorId: admin.id, userId: target.id, reason: 'Spam' })

    expect(await sessionsOf(target.id)).toHaveLength(0)
    const ctx = await auth.$context
    const refused = await ctx.internalAdapter
      .createSession(target.id)
      .catch((error: unknown) => error)
    expect(refused).toBeInstanceOf(Error)
    expect(refused).toMatchObject({
      body: expect.objectContaining({ code: 'ACCOUNT_BLOCKED' }),
    })
    expect(await sessionsOf(target.id)).toHaveLength(0)
  })

  it('records who blocked, when and why, audits it, and sends no email', async () => {
    const admin = await person({ admin: true })
    const target = await person()

    await blockUser({
      actorId: admin.id,
      userId: target.id,
      reason: '  Left the agency ',
    })

    const row = (await db.select().from(user).where(eq(user.id, target.id))).at(
      0,
    )
    expect(row?.blockedAt).toBeInstanceOf(Date)
    expect(row?.blockedById).toBe(admin.id)
    expect(row?.blockedReason).toBe('Left the agency')
    const [audit] = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.action, 'user.block'),
          eq(auditLog.targetId, target.id),
        ),
      )
    expect(audit).toMatchObject({
      actorId: admin.id,
      targetType: 'user',
      meta: expect.objectContaining({ reason: 'Left the agency' }),
    })
    expect(
      await db
        .select()
        .from(emailOutbox)
        .where(eq(emailOutbox.userId, target.id)),
    ).toHaveLength(0)
  })

  it('keeps memberships, and unblocking restores sign-in', async () => {
    const admin = await person({ admin: true })
    const target = await person()
    const org = await client()
    await join(target.id, org.id, 'editor')

    await blockUser({ actorId: admin.id, userId: target.id })
    await unblockUser({ actorId: admin.id, userId: target.id })

    const memberships = await db
      .select()
      .from(membership)
      .where(eq(membership.userId, target.id))
    expect(memberships).toHaveLength(1)
    const [row] = await db.select().from(user).where(eq(user.id, target.id))
    expect(row).toMatchObject({
      blockedAt: null,
      blockedById: null,
      blockedReason: null,
    })
    const ctx = await auth.$context
    await expect(
      ctx.internalAdapter.createSession(target.id),
    ).resolves.toBeTruthy()
    const audits = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.action, 'user.unblock'),
          eq(auditLog.targetId, target.id),
        ),
      )
    expect(audits).toHaveLength(1)
  })

  it('refuses the admin themselves through the admin functions', async () => {
    const admin = await person({ admin: true })
    await expect(
      blockUser({ actorId: admin.id, userId: admin.id }),
    ).rejects.toBeInstanceOf(ConflictError)
    await expect(
      deleteUser({ actorId: admin.id, userId: admin.id }),
    ).rejects.toBeInstanceOf(ConflictError)
  })

  it('suspends MCP keys: a blocked owner gets nothing, and unblocking brings the key back', async () => {
    const admin = await person({ admin: true })
    const target = await person()
    const { org, site, actor } = await createTestSite()
    clients.push(org.id)
    people.push(actor.id)
    await join(target.id, org.id, 'editor')
    const generated = generateMcpKey()
    await db.insert(mcpKey).values({
      userId: target.id,
      siteId: site.id,
      name: 'Laptop',
      tokenPrefix: generated.tokenPrefix,
      tokenHash: generated.tokenHash,
    })

    expect(await resolveMcpActorResult(generated.token)).toMatchObject({
      ok: true,
    })
    await blockUser({ actorId: admin.id, userId: target.id })
    expect(await resolveMcpActorResult(generated.token)).toEqual({
      ok: false,
      reason: 'invalid',
    })
    // Suspended, not revoked: the key row itself is untouched.
    const key = (
      await db
        .select()
        .from(mcpKey)
        .where(eq(mcpKey.tokenHash, generated.tokenHash))
    ).at(0)
    expect(key?.revokedAt).toBeNull()

    await unblockUser({ actorId: admin.id, userId: target.id })
    expect(await resolveMcpActorResult(generated.token)).toMatchObject({
      ok: true,
    })
  })

  it('cancels queued notices on block, and sends no new notices to a blocked person', async () => {
    const admin = await person({ admin: true })
    const target = await person()
    const { org, site, actor } = await createTestSite()
    clients.push(org.id)
    people.push(actor.id)
    await join(target.id, org.id, 'owner')
    const queued = await queuedNotice(target.id)

    // A notice created while the person was active, before the block.
    const subjectId = crypto.randomUUID()
    const payload = { siteId: site.id, siteName: 'Harbour', orgName: 'Acme' }
    const before = await notifyStrict({
      event: 'release.live',
      organizationId: org.id,
      subjectId,
      recipients: [{ userId: target.id, role: 'owner' }],
      payload,
    })
    expect(before.notified).toEqual([target.id])

    await blockUser({ actorId: admin.id, userId: target.id })

    const cancelled = (
      await db.select().from(emailOutbox).where(eq(emailOutbox.id, queued.id))
    ).at(0)
    expect(cancelled?.status).toBe('cancelled')
    // A notice that was already in flight is refused at send time.
    const notifications = await db
      .select()
      .from(notification)
      .where(eq(notification.userId, target.id))
    expect(notifications).toHaveLength(1)
    expect(await notificationStillEligible(notifications[0]?.id ?? '')).toBe(
      false,
    )

    // Fan-out after the block: the person is not a recipient at all.
    const later = await notifyStrict({
      event: 'release.live',
      organizationId: org.id,
      subjectId: crypto.randomUUID(),
      recipients: [{ userId: target.id, role: 'owner' }],
      payload,
    })
    expect(later.notified).toEqual([])
  })

  it('cancelAllQueuedNotificationEmails only touches that person’s queued notices', async () => {
    const target = await person()
    const other = await person()
    const mine = await queuedNotice(target.id)
    const theirs = await queuedNotice(other.id)

    const cancelled = await cancelAllQueuedNotificationEmails(target.id)

    expect(cancelled).toBe(1)
    const a = (
      await db.select().from(emailOutbox).where(eq(emailOutbox.id, mine.id))
    ).at(0)
    const b = (
      await db.select().from(emailOutbox).where(eq(emailOutbox.id, theirs.id))
    ).at(0)
    expect(a?.status).toBe('cancelled')
    expect(b?.status).toBe('queued')
  })

  it('a password reset for a blocked person sends nothing and removes the reset token', async () => {
    const admin = await person({ admin: true })
    const target = await person()
    await blockUser({ actorId: admin.id, userId: target.id })

    const token = 'blockedresettoken0000001'
    await db.insert(verification).values({
      id: crypto.randomUUID(),
      identifier: hashedVerificationIdentifier(`reset-password:${token}`),
      value: target.id,
      expiresAt: new Date(Date.now() + 60_000),
    })

    const result = await deliverPasswordReset({
      user: { id: target.id, email: target.email },
      token,
    })

    expect(result).toBeNull()
    expect(
      await db
        .select()
        .from(verification)
        .where(eq(verification.value, target.id)),
    ).toHaveLength(0)
    expect(
      await db
        .select()
        .from(emailOutbox)
        .where(eq(emailOutbox.userId, target.id)),
    ).toHaveLength(0)
  })
})

describe.skipIf(!hasDb)('last active agency admin', () => {
  /** Counts only the admins a test creates, whatever else the database holds. */
  function scopeTo(...admins: Array<{ id: string }>) {
    scope.ids = admins.map((admin) => admin.id)
  }

  it('blocked admins do not count as active, so the last active admin cannot be blocked', async () => {
    const adminA = await person({ admin: true })
    const adminB = await person({ admin: true })
    scopeTo(adminA, adminB)

    // A blocks B: A is now the only active admin.
    await blockUser({ actorId: adminA.id, userId: adminB.id })

    // B (blocked) tries to block A: A is the last active admin.
    await expect(
      blockUser({ actorId: adminB.id, userId: adminA.id }),
    ).rejects.toBeInstanceOf(LastAgencyAdminError)
    const a = (await db.select().from(user).where(eq(user.id, adminA.id))).at(0)
    expect(a?.blockedAt).toBeNull()
  })

  it('the last active admin cannot be deleted', async () => {
    const adminA = await person({ admin: true })
    const adminB = await person({ admin: true })
    scopeTo(adminA, adminB)
    await blockUser({ actorId: adminA.id, userId: adminB.id })

    await expect(
      deleteUser({ actorId: adminB.id, userId: adminA.id }),
    ).rejects.toBeInstanceOf(LastAgencyAdminError)
    const [a] = await db.select().from(user).where(eq(user.id, adminA.id))
    expect(a).toBeTruthy()
  })

  it('demoting the last active admin is refused, even when another admin is blocked', async () => {
    const adminA = await person({ admin: true })
    const adminB = await person({ admin: true })
    scopeTo(adminA, adminB)
    await blockUser({ actorId: adminA.id, userId: adminB.id })

    await expect(
      setAgencyAdmin(adminA.id, false, adminA.id),
    ).rejects.toBeInstanceOf(LastAgencyAdminError)
  })

  it('two admins blocking each other at the same moment: exactly one succeeds', async () => {
    const adminA = await person({ admin: true })
    const adminB = await person({ admin: true })
    scopeTo(adminA, adminB)

    const outcomes = await Promise.allSettled([
      blockUser({ actorId: adminA.id, userId: adminB.id }),
      blockUser({ actorId: adminB.id, userId: adminA.id }),
    ])

    const fulfilled = outcomes.filter((o) => o.status === 'fulfilled')
    const rejected = outcomes.filter(
      (o): o is PromiseRejectedResult => o.status === 'rejected',
    )
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect(rejected[0]?.reason).toBeInstanceOf(LastAgencyAdminError)
    const active = await db
      .select({ id: user.id })
      .from(user)
      .where(
        and(
          eq(user.isAgencyAdmin, true),
          isNull(user.blockedAt),
          inArray(user.id, [adminA.id, adminB.id]),
        ),
      )
    expect(active).toHaveLength(1)
  })

  it('bulk block: the first admin is blocked, the last one is skipped with its reason', async () => {
    const actor = await person()
    const first = await person({ admin: true })
    const last = await person({ admin: true })
    scopeTo(first, last)
    // Two active admins, and the actor is not one of them.
    const result = await bulkBlockUsers({
      actorId: actor.id,
      userIds: [first.id, last.id],
    })

    expect(result.done).toEqual([first.id])
    expect(result.skipped).toEqual([
      expect.objectContaining({
        userId: last.id,
        reason: 'last_active_admin',
      }),
    ])
  })
})

describe.skipIf(!hasDb)('security actions', () => {
  it('sign out everywhere ends every session and audits the count', async () => {
    const admin = await person({ admin: true })
    const target = await person()
    await signIn(target.id)
    await signIn(target.id)

    const result = await signOutEverywhere({
      actorId: admin.id,
      userId: target.id,
    })

    expect(result.sessionsEnded).toBe(2)
    expect(await sessionsOf(target.id)).toHaveLength(0)
    const audit = (
      await db
        .select()
        .from(auditLog)
        .where(
          and(
            eq(auditLog.action, 'user.sessions_revoke'),
            eq(auditLog.targetId, target.id),
          ),
        )
    ).at(0)
    expect(audit?.meta).toMatchObject({ sessionsEnded: 2 })
  })

  it('refuses to sign the admin out of their own sessions here', async () => {
    const admin = await person({ admin: true })
    await expect(
      signOutEverywhere({ actorId: admin.id, userId: admin.id }),
    ).rejects.toBeInstanceOf(ConflictError)
  })

  it('reset 2FA removes the secret and backup codes, flips the flag, ends sessions and queues a notice', async () => {
    const admin = await person({ admin: true })
    const target = await person({ twoFactor: true })
    await db.insert(twoFactor).values({
      id: crypto.randomUUID(),
      secret: 'enc-secret',
      backupCodes: 'enc-codes',
      userId: target.id,
      verified: true,
    })
    await signIn(target.id)

    await resetTwoFactor({ actorId: admin.id, userId: target.id })

    expect(
      await db.select().from(twoFactor).where(eq(twoFactor.userId, target.id)),
    ).toHaveLength(0)
    const row = (await db.select().from(user).where(eq(user.id, target.id))).at(
      0,
    )
    expect(row?.twoFactorEnabled).toBe(false)
    expect(await sessionsOf(target.id)).toHaveLength(0)
    const notice = (
      await db
        .select()
        .from(emailOutbox)
        .where(
          and(
            eq(emailOutbox.userId, target.id),
            eq(emailOutbox.kind, 'two_factor_reset'),
          ),
        )
    ).at(0)
    expect(notice).toMatchObject({ status: 'queued', locale: 'en' })
    expect(notice?.params).toEqual(
      expect.objectContaining({ actorName: admin.name }),
    )
    const audit = (
      await db
        .select()
        .from(auditLog)
        .where(
          and(
            eq(auditLog.action, 'user.two_factor_reset'),
            eq(auditLog.targetId, target.id),
          ),
        )
    ).at(0)
    expect(audit?.actorId).toBe(admin.id)
  })

  it('rename changes the name, audits it and sends no email', async () => {
    const admin = await person({ admin: true })
    const target = await person({ name: 'Old Name' })

    await renameUser({
      actorId: admin.id,
      userId: target.id,
      name: '  New Name ',
    })

    const row = (await db.select().from(user).where(eq(user.id, target.id))).at(
      0,
    )
    expect(row?.name).toBe('New Name')
    const audit = (
      await db
        .select()
        .from(auditLog)
        .where(
          and(
            eq(auditLog.action, 'user.rename'),
            eq(auditLog.targetId, target.id),
          ),
        )
    ).at(0)
    expect(audit?.meta).toMatchObject({
      userName: 'New Name',
      previousName: 'Old Name',
    })
    expect(
      await db
        .select()
        .from(emailOutbox)
        .where(eq(emailOutbox.userId, target.id)),
    ).toHaveLength(0)
  })

  it('bulk block skips the actor with reason self, and blocks everyone else', async () => {
    const admin = await person({ admin: true })
    const first = await person()
    const second = await person()

    const result = await bulkBlockUsers({
      actorId: admin.id,
      userIds: [admin.id, first.id, second.id],
    })

    expect(result.done.sort()).toEqual([first.id, second.id].sort())
    expect(result.skipped).toEqual([
      expect.objectContaining({ userId: admin.id, reason: 'self' }),
    ])
    const rows = await db
      .select({ blockedAt: user.blockedAt })
      .from(user)
      .where(inArray(user.id, [first.id, second.id]))
    expect(rows.every((row) => row.blockedAt !== null)).toBe(true)
  })

  it('people search matches name or email, flags blocked and invited people, and ignores blank queries', async () => {
    const tag = `search${crypto.randomUUID().slice(0, 6)}`
    const admin = await person({ admin: true })
    const blocked = await person({ name: `Blocked ${tag}` })
    const invitedOnly = await person({ name: `Invited ${tag}` })
    const plain = await person({ name: `Plain ${tag}` })
    await blockUser({ actorId: admin.id, userId: blocked.id })
    const org = await client()
    await db.insert(invitation).values({
      email: invitedOnly.email.toLowerCase(),
      organizationId: org.id,
      role: 'editor',
      tokenHash: `hash-${crypto.randomUUID()}`,
      expiresAt: new Date(Date.now() + 60_000),
    })

    const hits = await searchPeople(tag)
    expect(hits.map((hit) => hit.id).sort()).toEqual(
      [blocked.id, invitedOnly.id, plain.id].sort(),
    )
    expect(hits.find((hit) => hit.id === blocked.id)).toMatchObject({
      blocked: true,
      invited: false,
    })
    expect(hits.find((hit) => hit.id === invitedOnly.id)).toMatchObject({
      blocked: false,
      invited: true,
    })
    // Email matches too, and a blank query matches nobody.
    expect((await searchPeople(plain.email)).map((hit) => hit.id)).toEqual([
      plain.id,
    ])
    expect(await searchPeople('   ')).toEqual([])
  })
})

describe.skipIf(!hasDb)('people list', () => {
  it('reports status, blocker, last activity and two-factor for each person', async () => {
    const admin = await person({ admin: true, name: 'Lia Admin' })
    const active = await person({ name: 'Ana Active', twoFactor: true })
    const blocked = await person({ name: 'Bo Blocked' })
    await signIn(active.id)
    await blockUser({ actorId: admin.id, userId: blocked.id, reason: 'x' })

    const rows = await listUsers()
    const byId = new Map(rows.map((row) => [row.id, row]))

    expect(byId.get(active.id)).toMatchObject({
      status: 'active',
      twoFactorEnabled: true,
      blockedAt: null,
    })
    expect(byId.get(active.id)?.lastActiveAt).toBeInstanceOf(Date)
    expect(byId.get(blocked.id)).toMatchObject({
      status: 'blocked',
      blockedByName: 'Lia Admin',
      blockedReason: 'x',
    })
  })

  it('lists pending invitations across clients, and leaves accepted ones out', async () => {
    const org = await client('Invite Co')
    const tag = crypto.randomUUID().slice(0, 8)
    await db.insert(invitation).values([
      {
        email: `pending-${tag}@areca.test`,
        organizationId: org.id,
        role: 'editor',
        tokenHash: `h-${crypto.randomUUID()}`,
        expiresAt: new Date(Date.now() + 60_000),
      },
      {
        email: `accepted-${tag}@areca.test`,
        organizationId: org.id,
        role: 'owner',
        tokenHash: `h-${crypto.randomUUID()}`,
        expiresAt: new Date(Date.now() + 60_000),
        acceptedAt: new Date(),
      },
    ])

    const pending = await listPendingInvitations()
    const mine = pending.filter((row) => row.organizationId === org.id)

    expect(mine.map((row) => row.email)).toEqual([`pending-${tag}@areca.test`])
    expect(mine[0]).toMatchObject({
      organizationName: 'Invite Co',
      role: 'editor',
    })
    expect(mine[0]).not.toHaveProperty('tokenHash')
  })
})
