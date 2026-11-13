import { and, eq } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'

import { db } from '#/db'
import {
  emailOutbox,
  membership,
  notification,
  notificationPreference,
  organization,
  user,
} from '#/db/schema'
import { enqueueEmail, processOutbox } from '#/server/mail/outbox'

const hasDb = Boolean(process.env.DATABASE_URL)

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.()
})

/**
 * An organization with one editor who has a notification row and a queued
 * email for `release.live`, as the fan-out would have left them.
 */
async function queuedNotificationEmail() {
  const suffix = crypto.randomUUID()
  const org = (
    await db
      .insert(organization)
      .values({ name: `Eligible ${suffix}`, slug: `eligible-${suffix}` })
      .returning()
  ).at(0)
  const person = (
    await db
      .insert(user)
      .values({
        id: crypto.randomUUID(),
        name: 'Eli Gible',
        email: `eligible-${suffix}@areca.local`,
        emailVerified: true,
        locale: 'en',
      })
      .returning()
  ).at(0)
  if (!org || !person) throw new Error('fixture failed')
  await db
    .insert(membership)
    .values({ userId: person.id, organizationId: org.id, role: 'editor' })
  const row = (
    await db
      .insert(notification)
      .values({
        userId: person.id,
        organizationId: org.id,
        event: 'release.live',
        payload: { organizationId: org.id, recipientRole: 'editor' },
        dedupeKey: `release.live:${suffix}:${person.id}`,
      })
      .returning()
  ).at(0)
  if (!row) throw new Error('fixture failed')
  const queued = await enqueueEmail({
    kind: 'release.live',
    template: 'notification',
    to: person.email,
    params: { userId: person.id, notificationId: row.id },
    locale: 'en',
    userId: person.id,
    organizationId: org.id,
    notificationId: row.id,
  })
  cleanups.push(async () => {
    await db.delete(organization).where(eq(organization.id, org.id))
    await db.delete(user).where(eq(user.id, person.id))
  })
  return { org, person, outboxId: queued.id }
}

async function statusOf(outboxId: string) {
  const rows = await db
    .select({ status: emailOutbox.status, sentAt: emailOutbox.sentAt })
    .from(emailOutbox)
    .where(eq(emailOutbox.id, outboxId))
    .limit(1)
  return rows.at(0)
}

describe.skipIf(!hasDb)('notification emails at send time', () => {
  it('cancels the email when the recipient has left the organization', async () => {
    const { org, person, outboxId } = await queuedNotificationEmail()
    await db
      .delete(membership)
      .where(
        and(
          eq(membership.userId, person.id),
          eq(membership.organizationId, org.id),
        ),
      )

    await processOutbox({ only: [outboxId] })

    expect(await statusOf(outboxId)).toEqual({
      status: 'cancelled',
      sentAt: null,
    })
  })

  it('cancels the email when the recipient has turned the kind off', async () => {
    const { org, person, outboxId } = await queuedNotificationEmail()
    await db.insert(notificationPreference).values({
      userId: person.id,
      organizationId: org.id,
      event: 'release.live',
      enabled: false,
    })

    await processOutbox({ only: [outboxId] })

    expect((await statusOf(outboxId))?.status).toBe('cancelled')
  })

  it('keeps the email while the recipient is still eligible', async () => {
    const { outboxId } = await queuedNotificationEmail()

    await processOutbox({ only: [outboxId] })

    // Still eligible, so it is delivered (sent or failed), never cancelled.
    expect((await statusOf(outboxId))?.status).not.toBe('cancelled')
  })
})
