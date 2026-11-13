/* eslint-disable @typescript-eslint/no-unnecessary-condition -- Drizzle row arrays can be empty at runtime, so lookups stay defensive. */
import { and, eq } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'

import { db } from '#/db'
import {
  auditLog,
  invitation,
  notification,
  notificationRule,
  organization,
} from '#/db/schema'
import type { EventKey } from '#/lib/notifications'

import { hashToken } from '#/server/security/token-hash'

import { writeRule } from './preferences.ts'
import {
  notifyInviteAccepted,
  notifyPublicationFailed,
  notifyPublicationLive,
  deliverScheduleFailed,
  scheduleFailedSubject,
} from './triggers.ts'
import {
  processPublicationEvents,
  queueScheduleFailedEvent,
} from './publication-events.ts'
import {
  addMember,
  createTestSite,
  insertPublication,
  makeUser,
  removeUsers,
} from './test-utils.ts'

const cleanups: (() => Promise<void>)[] = []

afterEach(async () => {
  for (const run of cleanups.splice(0).reverse()) await run()
})

/**
 * A client org: owner `requester` (also the publisher), owner `ownerTwo`,
 * editor `editor`, and a non-member agency admin `agencyAdmin`.
 */
async function setup() {
  const ctx = await createTestSite()
  const requester = await makeUser({ name: 'Rowan Requester' })
  const ownerTwo = await makeUser({ name: 'Ottilie Owner' })
  const editor = await makeUser({ name: 'Eli Editor' })
  const agencyAdmin = await makeUser({ name: 'Ada Agency', agencyAdmin: true })
  await addMember(requester.id, ctx.org.id, 'owner')
  await addMember(ownerTwo.id, ctx.org.id, 'owner')
  await addMember(editor.id, ctx.org.id, 'editor')
  cleanups.push(async () => {
    await db.delete(organization).where(eq(organization.id, ctx.org.id))
    await removeUsers([
      requester.id,
      ownerTwo.id,
      editor.id,
      agencyAdmin.id,
      ctx.actor.id,
    ])
  })
  return { ...ctx, requester, ownerTwo, editor, agencyAdmin }
}

async function rowFor(event: EventKey, subjectId: string, userId: string) {
  const [row] = await db
    .select()
    .from(notification)
    .where(eq(notification.dedupeKey, `${event}:${subjectId}:${userId}`))
  return row
}

async function setOrgRule(
  orgId: string,
  event: EventKey,
  enabled: boolean,
  actorId: string,
) {
  await writeRule({
    organizationId: orgId,
    event,
    role: 'owner',
    enabled,
    locked: false,
    updatedBy: actorId,
  })
  cleanups.push(async () => {
    await db
      .delete(notificationRule)
      .where(
        and(
          eq(notificationRule.organizationId, orgId),
          eq(notificationRule.event, event),
        ),
      )
  })
}

describe('publication went live', () => {
  it('tells a manual release requester, with the entries that changed', async () => {
    const { site, requester, ownerTwo, editor } = await setup()
    const pub = await insertPublication({
      siteId: site.id,
      requestedBy: requester.id,
      entries: [{ slug: 'hello', title: 'Hello world' }],
    })

    await notifyPublicationLive(pub.id)

    const row = await rowFor('release.live', pub.id, requester.id)
    expect(row?.payload).toMatchObject({
      siteName: site.name,
      orgName: expect.any(String),
      entries: [{ title: 'Hello world', collection: 'blog', change: 'added' }],
    })
    // Other owners get `release.live.others`, which is off by default.
    expect(
      await rowFor('release.live.others', pub.id, ownerTwo.id),
    ).toBeUndefined()
    expect(await rowFor('release.live', pub.id, editor.id)).toBeUndefined()
  })

  it('tells other owners when they turned on the organization default', async () => {
    const { site, org, requester, ownerTwo } = await setup()
    await setOrgRule(org.id, 'release.live.others', true, requester.id)
    const pub = await insertPublication({
      siteId: site.id,
      requestedBy: requester.id,
    })

    await notifyPublicationLive(pub.id)

    expect(
      await rowFor('release.live.others', pub.id, ownerTwo.id),
    ).toBeDefined()
    expect(
      await rowFor('release.live.others', pub.id, requester.id),
    ).toBeUndefined()
  })

  it('tells the people who scheduled a scheduled release, not the system requester', async () => {
    const { site, requester, editor } = await setup()
    const pub = await insertPublication({
      siteId: site.id,
      origin: 'scheduled',
      requestedBy: null,
      scheduledBy: [editor.id],
    })

    await notifyPublicationLive(pub.id)

    expect(await rowFor('schedule.published', pub.id, editor.id)).toBeDefined()
    expect(await rowFor('release.live', pub.id, requester.id)).toBeUndefined()
  })

  it('tells owners about a rollback when they turned it on, and the requester gets release.live', async () => {
    const { site, org, requester, ownerTwo } = await setup()
    const pub = await insertPublication({
      siteId: site.id,
      origin: 'rollback',
      requestedBy: requester.id,
    })

    await notifyPublicationLive(pub.id)
    expect(await rowFor('rollback.live', pub.id, ownerTwo.id)).toBeUndefined()
    expect(await rowFor('release.live', pub.id, requester.id)).toBeDefined()

    await setOrgRule(org.id, 'rollback.live', true, requester.id)
    const second = await insertPublication({
      siteId: site.id,
      origin: 'rollback',
      requestedBy: requester.id,
    })
    await notifyPublicationLive(second.id)
    expect(await rowFor('rollback.live', second.id, ownerTwo.id)).toBeDefined()
    // The requester hears once, through release.live.
    expect(
      await rowFor('rollback.live', second.id, requester.id),
    ).toBeUndefined()
  })

  it('does nothing for a publication that is not live', async () => {
    const { site, requester } = await setup()
    const pub = await insertPublication({
      siteId: site.id,
      status: 'failed',
      requestedBy: requester.id,
    })

    await notifyPublicationLive(pub.id)

    expect(await rowFor('release.live', pub.id, requester.id)).toBeUndefined()
  })
})

describe('publication failed or stuck', () => {
  it('tells the requester and owners, and uses release.stuck when the outcome is unknown', async () => {
    const { site, requester, ownerTwo, editor } = await setup()
    const pub = await insertPublication({
      siteId: site.id,
      status: 'failed',
      requestedBy: requester.id,
    })

    await notifyPublicationFailed(pub.id, { stuck: false })

    expect(await rowFor('release.failed', pub.id, requester.id)).toBeDefined()
    expect(await rowFor('release.failed', pub.id, ownerTwo.id)).toBeDefined()
    // An editor who did not request the release is not told.
    expect(await rowFor('release.failed', pub.id, editor.id)).toBeUndefined()

    await notifyPublicationFailed(pub.id, { stuck: true })
    expect(await rowFor('release.stuck', pub.id, requester.id)).toBeDefined()
    expect(await rowFor('release.stuck', pub.id, ownerTwo.id)).toBeDefined()
  })

  it('alerts agency admins outside the org once, and skips an admin who already heard as an owner', async () => {
    const { site, requester, agencyAdmin, org } = await setup()
    // Agency admin who is also an owner of this org.
    const insider = await makeUser({ name: 'Ina Insider', agencyAdmin: true })
    await addMember(insider.id, org.id, 'owner')
    cleanups.push(() => removeUsers([insider.id]))
    const pub = await insertPublication({
      siteId: site.id,
      status: 'failed',
      requestedBy: requester.id,
    })

    await notifyPublicationFailed(pub.id, { stuck: false })
    await notifyPublicationFailed(pub.id, { stuck: false })

    const alert = await rowFor('agency.release.failed', pub.id, agencyAdmin.id)
    expect(alert).toMatchObject({
      organizationId: org.id,
      event: 'agency.release.failed',
    })
    expect(alert?.payload).toMatchObject({ recipientRole: 'agency' })
    expect(
      await rowFor('agency.release.failed', pub.id, insider.id),
    ).toBeUndefined()
    expect(await rowFor('release.failed', pub.id, insider.id)).toBeDefined()
  })
})

describe('scheduled publish failed', () => {
  it('tells owners once per schedule approval and alerts agency admins', async () => {
    const { site, org, requester, editor, ownerTwo, agencyAdmin } =
      await setup()
    const fingerprint = `fp-${crypto.randomUUID()}`
    const subjectId = scheduleFailedSubject(site.id, fingerprint)
    const input = {
      siteId: site.id,
      fingerprint,
      scheduledBy: [editor.id],
    }

    // The failure's state change queues the notice; a repeat queues nothing.
    await queueScheduleFailedEvent(db, input)
    await queueScheduleFailedEvent(db, input)
    await processPublicationEvents({ only: { siteIds: [site.id] } })
    await processPublicationEvents({ only: { siteIds: [site.id] } })

    expect(
      await rowFor('schedule.failed', subjectId, requester.id),
    ).toBeDefined()
    expect(
      await rowFor('schedule.failed', subjectId, ownerTwo.id),
    ).toBeDefined()
    // The scheduler is an editor, and schedule failures only reach owners.
    expect(
      await rowFor('schedule.failed', subjectId, editor.id),
    ).toBeUndefined()
    expect(
      await rowFor('agency.release.failed', subjectId, agencyAdmin.id),
    ).toMatchObject({ organizationId: org.id })

    const rows = await db
      .select()
      .from(notification)
      .where(
        eq(
          notification.dedupeKey,
          `schedule.failed:${subjectId}:${requester.id}`,
        ),
      )
    expect(rows).toHaveLength(1)
  })
})

describe('invitation accepted', () => {
  it('tells the member who sent the invitation', async () => {
    const { org, requester } = await setup()
    const invitee = await makeUser({ name: 'Nora Newcomer' })
    cleanups.push(() => removeUsers([invitee.id]))
    const invite = await createInvitation(org.id, requester.id)

    await notifyInviteAccepted(invite.id, invitee.id)

    const row = await rowFor('invite.accepted', invite.id, requester.id)
    expect(row?.payload).toMatchObject({
      inviteeName: 'Nora Newcomer',
      role: 'editor',
      orgName: org.name,
    })
  })

  it('tells an agency admin who sent the invitation from outside the org, as the agency role', async () => {
    const { org, agencyAdmin } = await setup()
    const invitee = await makeUser({ name: 'Nico New' })
    cleanups.push(() => removeUsers([invitee.id]))
    const invite = await createInvitation(org.id, agencyAdmin.id)

    await notifyInviteAccepted(invite.id, invitee.id)

    expect(
      await rowFor('invite.accepted', invite.id, agencyAdmin.id),
    ).toMatchObject({ organizationId: org.id })
    const row = await rowFor('invite.accepted', invite.id, agencyAdmin.id)
    expect(row?.payload).toMatchObject({ recipientRole: 'agency' })
  })

  it('tells an agency admin who is also a member under their membership role', async () => {
    const { org } = await setup()
    const memberAdmin = await makeUser({
      name: 'Mia Member',
      agencyAdmin: true,
    })
    const invitee = await makeUser({ name: 'Ivo Invitee' })
    cleanups.push(() => removeUsers([memberAdmin.id, invitee.id]))
    await addMember(memberAdmin.id, org.id, 'owner')
    const invite = await createInvitation(org.id, memberAdmin.id)

    await notifyInviteAccepted(invite.id, invitee.id)

    const row = await rowFor('invite.accepted', invite.id, memberAdmin.id)
    expect(row?.payload).toMatchObject({ recipientRole: 'owner' })
  })

  it('does nothing when the invitation has no recorded sender', async () => {
    const { org } = await setup()
    const invitee = await makeUser({ name: 'Otto Orphan' })
    cleanups.push(() => removeUsers([invitee.id]))
    const invite = await createInvitation(org.id, null)

    await expect(
      notifyInviteAccepted(invite.id, invitee.id),
    ).resolves.toBeUndefined()
    const rows = await db
      .select()
      .from(notification)
      .where(
        eq(
          notification.dedupeKey,
          `invite.accepted:${invite.id}:${invitee.id}`,
        ),
      )
    expect(rows).toEqual([])
  })
})

describe('never fails the caller', () => {
  it('resolves for publications and invitations that do not exist', async () => {
    await expect(
      notifyPublicationLive(crypto.randomUUID()),
    ).resolves.toBeUndefined()
    await expect(
      notifyPublicationFailed(crypto.randomUUID(), { stuck: true }),
    ).resolves.toBeUndefined()
    await expect(
      notifyInviteAccepted(crypto.randomUUID(), crypto.randomUUID()),
    ).resolves.toBeUndefined()
  })

  it('treats a schedule whose site is gone as nothing to tell', async () => {
    // Unlike the wrappers above, this throws on a database failure so the
    // events loop retries it. A missing site is not a failure.
    await expect(
      deliverScheduleFailed(crypto.randomUUID(), {
        scheduledBy: [],
        fingerprint: 'x',
      }),
    ).resolves.toBeUndefined()
  })
})

/** An accepted invitation, with its send recorded in the audit log the way `inviteMember` writes it. */
async function createInvitation(orgId: string, senderId: string | null) {
  const [row] = await db
    .insert(invitation)
    .values({
      email: `invitee-${crypto.randomUUID()}@test.local`,
      organizationId: orgId,
      role: 'editor',
      tokenHash: hashToken(crypto.randomUUID()),
      expiresAt: new Date(Date.now() + 86_400_000),
      acceptedAt: new Date(),
    })
    .returning()
  if (!row) throw new Error('Failed to create invitation')
  if (senderId) {
    await db.insert(auditLog).values({
      organizationId: orgId,
      actorId: senderId,
      action: 'member.invite',
      targetType: 'invitation',
      targetId: row.id,
      meta: {},
    })
  }
  cleanups.push(async () => {
    await db.delete(invitation).where(eq(invitation.id, row.id))
  })
  return row
}
