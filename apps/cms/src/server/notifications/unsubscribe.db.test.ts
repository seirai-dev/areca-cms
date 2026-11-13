import { and, eq } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'

import { db } from '#/db'
import {
  auditLog,
  membership,
  notificationPreference,
  notificationRule,
  organization,
} from '#/db/schema'
import type { EventKey } from '#/lib/notifications'

import { writeRule } from './preferences.ts'
import {
  applyUnsubscribe,
  inspectUnsubscribe,
  signUnsubscribeToken,
} from './unsubscribe.ts'
import {
  addMember,
  createTestSite,
  makeUser,
  removeUsers,
} from './test-utils.ts'

const cleanups: (() => Promise<void>)[] = []

afterEach(async () => {
  for (const run of cleanups.splice(0).reverse()) await run()
})

async function setup() {
  const ctx = await createTestSite()
  const owner = await makeUser({ name: 'Una Unsubscriber' })
  await addMember(owner.id, ctx.org.id, 'owner')
  cleanups.push(async () => {
    await db.delete(organization).where(eq(organization.id, ctx.org.id))
    await removeUsers([owner.id, ctx.actor.id])
  })
  return { ...ctx, owner }
}

describe('unsubscribe links', () => {
  it('turns an event off for that user and organization, once', async () => {
    const { owner, org } = await setup()
    const token = signUnsubscribeToken({
      userId: owner.id,
      organizationId: org.id,
      event: 'release.live',
    })

    expect(await inspectUnsubscribe(token)).toMatchObject({
      status: 'ok',
      event: 'release.live',
      orgName: org.name,
    })

    expect(await applyUnsubscribe(token)).toEqual({ ok: true, changed: true })
    expect(await inspectUnsubscribe(token)).toMatchObject({
      status: 'already_off',
    })
    expect(await applyUnsubscribe(token)).toEqual({ ok: true, changed: false })

    const choice = (
      await db
        .select()
        .from(notificationPreference)
        .where(
          and(
            eq(notificationPreference.userId, owner.id),
            eq(notificationPreference.organizationId, org.id),
            eq(notificationPreference.event, 'release.live'),
          ),
        )
    ).at(0)
    expect(choice?.enabled).toBe(false)

    const audited = await db
      .select({ id: auditLog.id })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.actorId, owner.id),
          eq(auditLog.action, 'notification_preference.update'),
        ),
      )
    // Only the change is audited, not the repeat.
    expect(audited).toHaveLength(1)
  })

  it('refuses a locked event and changes nothing', async () => {
    const { owner, org } = await setup()
    await writeRule({
      organizationId: org.id,
      event: 'release.failed',
      role: 'owner',
      enabled: true,
      locked: true,
      updatedBy: owner.id,
    })
    cleanups.push(async () => {
      await db
        .delete(notificationRule)
        .where(eq(notificationRule.organizationId, org.id))
    })
    const token = signUnsubscribeToken({
      userId: owner.id,
      organizationId: org.id,
      event: 'release.failed',
    })

    expect(await inspectUnsubscribe(token)).toMatchObject({
      status: 'locked',
      lockedBy: 'organization',
      orgName: org.name,
    })
    expect(await applyUnsubscribe(token)).toEqual({
      ok: false,
      reason: 'locked',
    })
    const choices = await db
      .select()
      .from(notificationPreference)
      .where(eq(notificationPreference.userId, owner.id))
    expect(choices).toEqual([])
  })

  it('reports an expired link without changing anything', async () => {
    const { owner, org } = await setup()
    const day = 24 * 60 * 60 * 1000
    const token = signUnsubscribeToken(
      { userId: owner.id, organizationId: org.id, event: 'release.live' },
      new Date(Date.now() - 61 * day),
    )

    expect(await inspectUnsubscribe(token)).toMatchObject({ status: 'expired' })
    expect(await applyUnsubscribe(token)).toEqual({
      ok: false,
      reason: 'expired',
    })
  })

  it('treats a tampered link as invalid', async () => {
    expect(await inspectUnsubscribe('not.a-real-token')).toEqual({
      status: 'invalid',
    })
    expect(await applyUnsubscribe('')).toEqual({
      ok: false,
      reason: 'invalid',
    })
  })

  it('treats a link for someone who is no longer a member as invalid', async () => {
    const { owner, org } = await setup()
    const token = signUnsubscribeToken({
      userId: owner.id,
      organizationId: org.id,
      event: 'release.live',
    })
    await db
      .delete(membership)
      .where(
        and(
          eq(membership.userId, owner.id),
          eq(membership.organizationId, org.id),
        ),
      )

    expect(await inspectUnsubscribe(token)).toEqual({ status: 'invalid' })
    expect(await applyUnsubscribe(token)).toEqual({
      ok: false,
      reason: 'invalid',
    })
  })

  it('stores agency-alert opt-outs on the global scope, not an organization', async () => {
    const admin = await makeUser({ name: 'Agency Ari', agencyAdmin: true })
    cleanups.push(() => removeUsers([admin.id]))
    const event: EventKey = 'agency.release.failed'
    const token = signUnsubscribeToken({
      userId: admin.id,
      organizationId: null,
      event,
    })

    expect(await applyUnsubscribe(token)).toEqual({ ok: true, changed: true })

    const [choice] = await db
      .select()
      .from(notificationPreference)
      .where(eq(notificationPreference.userId, admin.id))
    expect(choice).toMatchObject({
      organizationId: null,
      event,
      enabled: false,
    })
  })
})
