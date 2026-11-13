import type * as MailConfig from '#/server/mail/config'
import type * as MailTransport from '#/server/mail/transport'

import { and, eq, inArray } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { db } from '#/db'
import {
  emailOutbox,
  notification,
  notificationPreference,
  notificationRule,
  organization,
} from '#/db/schema'
import type { EventKey } from '#/lib/notifications'
import { processOutbox } from '#/server/mail/outbox'

import { cleanupNotifications, notify } from './notify.ts'
import { writeChoice, writeRule } from './preferences.ts'
import {
  addMember,
  createTestSite,
  makeUser,
  removeUsers,
} from './test-utils.ts'

// `configured: false` simulates "Mail isn't set up" for the fan-out.
const mail = vi.hoisted(() => ({
  configured: true,
  sent: [] as { to: string; headers?: Record<string, string> }[],
}))

const FAKE_CONFIG = {
  source: 'env',
  host: 'mail.test',
  port: 587,
  secure: 'starttls',
  username: null,
  password: null,
  from: 'Areca <no-reply@test.local>',
  replyTo: null,
} as const

vi.mock('#/server/mail/config', async (importOriginal) => {
  const actual = await importOriginal<typeof MailConfig>()
  return {
    ...actual,
    isMailConfigured: async () => mail.configured,
    resolveMailConfig: async () => (mail.configured ? FAKE_CONFIG : null),
  }
})

// Captures what the outbox hands to SMTP, so headers can be checked without a server.
vi.mock('#/server/mail/transport', async (importOriginal) => {
  const actual = await importOriginal<typeof MailTransport>()
  return {
    ...actual,
    sendMail: async (
      _config: unknown,
      message: { to: string; headers?: Record<string, string> },
    ) => {
      mail.sent.push({ to: message.to, headers: message.headers })
      return { messageId: `test-${crypto.randomUUID()}` }
    },
  }
})

const cleanups: (() => Promise<void>)[] = []

beforeEach(() => {
  mail.configured = true
  mail.sent.length = 0
})

afterEach(async () => {
  for (const run of cleanups.splice(0).reverse()) await run()
})

/** One client org with an owner, an editor, an unverified owner, all removed afterwards. */
async function setup() {
  const ctx = await createTestSite()
  const owner = await makeUser({ name: 'Olive Owner', locale: 'nl' })
  const editor = await makeUser({ name: 'Ed Editor' })
  const unverified = await makeUser({ verified: false })
  await addMember(owner.id, ctx.org.id, 'owner')
  await addMember(editor.id, ctx.org.id, 'editor')
  await addMember(unverified.id, ctx.org.id, 'owner')
  cleanups.push(async () => {
    await db.delete(organization).where(eq(organization.id, ctx.org.id))
    await removeUsers([owner.id, editor.id, unverified.id, ctx.actor.id])
  })
  return { ...ctx, owner, editor, unverified }
}

/** Agency-role admin: global, so removed by the test that makes it. */
async function makeAgencyAdmin(name: string) {
  const admin = await makeUser({ name, agencyAdmin: true })
  cleanups.push(() => removeUsers([admin.id]))
  return admin
}

function payloadFor(siteId: string, orgId: string) {
  return { siteId, siteName: 'Harbour', orgName: 'Acme', organizationId: orgId }
}

/** Rows for one subject across the events these tests use. */
async function rowsForSubject(subjectId: string, userIds: string[]) {
  const events: EventKey[] = [
    'release.live',
    'release.live.others',
    'release.failed',
    'release.stuck',
    'agency.release.failed',
  ]
  return db
    .select()
    .from(notification)
    .where(
      inArray(
        notification.dedupeKey,
        events.flatMap((event) =>
          userIds.map((id) => `${event}:${subjectId}:${id}`),
        ),
      ),
    )
}

async function clearOrgRules(orgId: string) {
  await db
    .delete(notificationRule)
    .where(eq(notificationRule.organizationId, orgId))
}

describe('notify: fan-out', () => {
  it('stores a row per recipient whose preference is on and queues mail for verified addresses', async () => {
    const { site, org, owner, editor, unverified } = await setup()
    const subjectId = crypto.randomUUID()
    const ids = [owner.id, editor.id, unverified.id]

    const result = await notify({
      event: 'release.live',
      organizationId: org.id,
      subjectId,
      recipients: [
        { userId: owner.id, role: 'owner' },
        { userId: editor.id, role: 'editor' },
        { userId: unverified.id, role: 'owner' },
      ],
      payload: { siteId: site.id, siteName: 'Harbour', orgName: 'Acme' },
    })

    expect(result.notified.sort()).toEqual([...ids].sort())
    expect(await rowsForSubject(subjectId, ids)).toHaveLength(3)

    const queued = await db
      .select()
      .from(emailOutbox)
      .where(inArray(emailOutbox.userId, ids))
    expect(queued.map((row) => row.userId).sort()).toEqual(
      [owner.id, editor.id].sort(),
    )
    const ownerMail = queued.find((row) => row.userId === owner.id)
    expect(ownerMail).toMatchObject({
      kind: 'release.live',
      template: 'notification',
      locale: 'nl',
      organizationId: org.id,
    })
    expect(ownerMail?.notificationId).toBeTruthy()
    expect(ownerMail?.params).toMatchObject({ userId: owner.id })
  })

  it('records the lock and the recipient role on each row', async () => {
    const { site, org, owner } = await setup()
    cleanups.push(() => clearOrgRules(org.id))
    const subjectId = crypto.randomUUID()
    await writeRule({
      organizationId: org.id,
      event: 'release.failed',
      role: 'owner',
      enabled: true,
      locked: true,
      updatedBy: owner.id,
    })

    await notify({
      event: 'release.failed',
      organizationId: org.id,
      subjectId,
      recipients: [{ userId: owner.id, role: 'owner' }],
      payload: payloadFor(site.id, org.id),
    })

    const row = (
      await db
        .select()
        .from(notification)
        .where(
          eq(notification.dedupeKey, `release.failed:${subjectId}:${owner.id}`),
        )
    ).at(0)
    expect(row?.payload).toMatchObject({
      recipientRole: 'owner',
      lockedBy: 'organization',
    })
  })

  it('skips recipients whose preference is off', async () => {
    const { site, org, owner } = await setup()
    cleanups.push(() => clearOrgRules(org.id))
    const subjectId = crypto.randomUUID()

    // Built-in default: `release.live.others` is off for owners.
    const off = await notify({
      event: 'release.live.others',
      organizationId: org.id,
      subjectId,
      recipients: [{ userId: owner.id, role: 'owner' }],
      payload: payloadFor(site.id, org.id),
    })
    expect(off.notified).toEqual([])

    await writeRule({
      organizationId: org.id,
      event: 'release.live.others',
      role: 'owner',
      enabled: true,
      locked: false,
      updatedBy: owner.id,
    })
    const on = await notify({
      event: 'release.live.others',
      organizationId: org.id,
      subjectId,
      recipients: [{ userId: owner.id, role: 'owner' }],
      payload: payloadFor(site.id, org.id),
    })
    expect(on.notified).toEqual([owner.id])
  })

  it('lets a locked event through even when the user turned it off', async () => {
    const { site, org, owner } = await setup()
    cleanups.push(async () => {
      await clearOrgRules(org.id)
      await db
        .delete(notificationPreference)
        .where(eq(notificationPreference.userId, owner.id))
    })
    await writeChoice({
      userId: owner.id,
      organizationId: org.id,
      event: 'release.failed',
      enabled: false,
    })
    const subjectId = crypto.randomUUID()

    const unlocked = await notify({
      event: 'release.failed',
      organizationId: org.id,
      subjectId,
      recipients: [{ userId: owner.id, role: 'owner' }],
      payload: payloadFor(site.id, org.id),
    })
    expect(unlocked.notified).toEqual([])

    await writeRule({
      organizationId: org.id,
      event: 'release.failed',
      role: 'owner',
      enabled: true,
      locked: true,
      updatedBy: owner.id,
    })
    const locked = await notify({
      event: 'release.failed',
      organizationId: org.id,
      subjectId,
      recipients: [{ userId: owner.id, role: 'owner' }],
      payload: payloadFor(site.id, org.id),
    })
    expect(locked.notified).toEqual([owner.id])
  })

  it('answers the agency role from agency rules, not organization rules', async () => {
    const { site, org, owner } = await setup()
    cleanups.push(() => clearOrgRules(org.id))
    const admin = await makeAgencyAdmin('Ada Agency')
    await writeRule({
      organizationId: org.id,
      event: 'release.failed',
      role: 'owner',
      enabled: false,
      locked: false,
      updatedBy: owner.id,
    })
    const subjectId = crypto.randomUUID()

    const result = await notify({
      event: 'release.failed',
      organizationId: org.id,
      subjectId,
      recipients: [
        { userId: owner.id, role: 'owner' },
        { userId: admin.id, role: 'agency' },
      ],
      payload: payloadFor(site.id, org.id),
    })

    expect(result.notified).toEqual([admin.id])
  })

  it('stores rows but queues no mail when mail is not configured', async () => {
    const { site, org, owner } = await setup()
    mail.configured = false
    const subjectId = crypto.randomUUID()

    const result = await notify({
      event: 'release.live',
      organizationId: org.id,
      subjectId,
      recipients: [{ userId: owner.id, role: 'owner' }],
      payload: payloadFor(site.id, org.id),
    })

    expect(result.notified).toEqual([owner.id])
    const queued = await db
      .select()
      .from(emailOutbox)
      .where(eq(emailOutbox.userId, owner.id))
    expect(queued).toEqual([])
  })

  it('dedupes a repeat call: no new row, no new mail, and the recipient is still reported', async () => {
    const { site, org, owner } = await setup()
    const subjectId = crypto.randomUUID()
    const input = {
      event: 'release.live' as const,
      organizationId: org.id,
      subjectId,
      recipients: [{ userId: owner.id, role: 'owner' as const }],
      payload: payloadFor(site.id, org.id),
    }

    await notify(input)
    const again = await notify(input)

    expect(again.notified).toEqual([owner.id])
    expect(await rowsForSubject(subjectId, [owner.id])).toHaveLength(1)
    const queued = await db
      .select()
      .from(emailOutbox)
      .where(eq(emailOutbox.userId, owner.id))
    expect(queued).toHaveLength(1)
  })

  it('never throws, even for input it cannot resolve', async () => {
    const { org } = await setup()
    await expect(
      notify({
        event: 'not.an.event' as EventKey,
        organizationId: org.id,
        subjectId: 'x',
        recipients: [{ userId: 'nobody', role: 'owner' }],
        payload: {},
      }),
    ).resolves.toEqual({ notified: [] })
  })

  it('sends the queued email with List-Unsubscribe headers', async () => {
    const { site, org, owner } = await setup()
    await notify({
      event: 'release.live',
      organizationId: org.id,
      subjectId: crypto.randomUUID(),
      recipients: [{ userId: owner.id, role: 'owner' }],
      payload: payloadFor(site.id, org.id),
    })
    const queued = (
      await db
        .select()
        .from(emailOutbox)
        .where(eq(emailOutbox.userId, owner.id))
    ).at(0)
    expect(queued).toBeTruthy()

    await processOutbox({ only: [queued?.id ?? ''] })

    const sent = mail.sent.find((message) => message.to === owner.email)
    expect(sent?.headers).toMatchObject({
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    })
    expect(sent?.headers?.['List-Unsubscribe']).toMatch(
      /^<.+\/api\/notifications\/unsubscribe\?token=[^>]+>$/,
    )
  })
})

describe('notify: retention', () => {
  it('deletes rows older than 30 days and keeps recent ones', async () => {
    const { site, org, owner } = await setup()
    const day = 24 * 60 * 60 * 1000
    const old = (
      await db
        .insert(notification)
        .values({
          userId: owner.id,
          organizationId: org.id,
          siteId: site.id,
          event: 'release.live',
          payload: {},
          dedupeKey: `release.live:old:${owner.id}`,
          createdAt: new Date(Date.now() - 31 * day),
        })
        .returning({ id: notification.id })
    ).at(0)
    const recent = (
      await db
        .insert(notification)
        .values({
          userId: owner.id,
          organizationId: org.id,
          siteId: site.id,
          event: 'release.live',
          payload: {},
          dedupeKey: `release.live:recent:${owner.id}`,
        })
        .returning({ id: notification.id })
    ).at(0)

    const removed = await cleanupNotifications()

    expect(removed).toBeGreaterThanOrEqual(1)
    const remaining = await db
      .select({ id: notification.id })
      .from(notification)
      .where(and(inArray(notification.id, [old?.id ?? '', recent?.id ?? ''])))
    expect(remaining.map((row) => row.id)).toEqual([recent?.id])
  })
})
