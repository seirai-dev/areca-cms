import { and, eq, inArray } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'

import { db } from '#/db'
import { auditLog, emailOutbox, mcpKey, membership, user } from '#/db/schema'
import { cleanupTestSite, createTestSite } from '#/server/content/test-utils'

import { removeMember } from './members.ts'
import { setAgencyAdmin } from './agency-admins.ts'

const hasDb = Boolean(process.env.DATABASE_URL)

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.()
})

/** An organization with a site, an owner (actor) and an editor who has a key. */
async function fixture() {
  const suffix = crypto.randomUUID()
  const { org, site: quay, actor } = await createTestSite()
  const owner = (
    await db
      .insert(user)
      .values({
        id: crypto.randomUUID(),
        name: 'Owen Owner',
        email: `owner-${suffix}@areca.local`,
        emailVerified: true,
        locale: 'en',
      })
      .returning()
  ).at(0)
  const member = (
    await db
      .insert(user)
      .values({
        id: crypto.randomUUID(),
        name: 'Edith Editor',
        email: `editor-${suffix}@areca.local`,
        emailVerified: true,
        locale: 'en',
      })
      .returning()
  ).at(0)
  if (!owner || !member) throw new Error('fixture failed')
  await db.insert(membership).values([
    { userId: owner.id, organizationId: org.id, role: 'owner' },
    { userId: member.id, organizationId: org.id, role: 'editor' },
  ])
  cleanups.push(async () => {
    await cleanupTestSite({ org, actor })
    await db
      .delete(emailOutbox)
      .where(inArray(emailOutbox.userId, [owner.id, member.id]))
    await db.delete(user).where(inArray(user.id, [owner.id, member.id]))
  })
  return { org, owner, member, quay }
}

describe.skipIf(!hasDb)('member removal revokes access', () => {
  it('revokes personal MCP keys on the org sites, cancels queued notices and audits it', async () => {
    const { org, owner, member, quay } = await fixture()
    const key = (
      await db
        .insert(mcpKey)
        .values({
          userId: member.id,
          siteId: quay.id,
          name: 'Laptop',
          tokenPrefix: 'areca_test',
          tokenHash: `hash-${crypto.randomUUID()}`,
        })
        .returning()
    ).at(0)
    const queued = (
      await db
        .insert(emailOutbox)
        .values({
          kind: 'notification',
          notificationId: 'content.published',
          toAddress: member.email,
          userId: member.id,
          organizationId: org.id,
          subject: 'Published',
          template: 'notification',
          params: { userId: member.id },
          locale: 'en',
          status: 'queued',
        })
        .returning()
    ).at(0)
    if (!key || !queued) throw new Error('fixture failed')

    await removeMember(org.id, member.id, owner.id)

    const revoked = (
      await db.select().from(mcpKey).where(eq(mcpKey.id, key.id))
    ).at(0)
    expect(revoked?.revokedAt).toBeInstanceOf(Date)
    const [cancelled] = await db
      .select()
      .from(emailOutbox)
      .where(eq(emailOutbox.id, queued.id))
    expect(cancelled).toMatchObject({ status: 'cancelled' })
    const [audit] = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.organizationId, org.id),
          eq(auditLog.action, 'member.mcp_access_revoke'),
        ),
      )
    expect(audit).toMatchObject({
      actorId: owner.id,
      targetType: 'membership',
      meta: expect.objectContaining({
        userId: member.id,
        mcpKeysRevoked: 1,
        notificationsCancelled: 1,
      }),
    })
  })
})

describe.skipIf(!hasDb)('agency admin grant and revoke notices', () => {
  it('queues a mandatory notice to the person and audits the change', async () => {
    const { owner, member } = await fixture()
    await setAgencyAdmin(member.id, true, owner.id)
    const granted = (
      await db
        .select()
        .from(emailOutbox)
        .where(
          and(
            eq(emailOutbox.userId, member.id),
            eq(emailOutbox.kind, 'agency_admin_granted'),
          ),
        )
    ).at(0)
    expect(granted).toMatchObject({ status: 'queued', locale: 'en' })
    expect(granted?.params).toEqual(
      expect.objectContaining({ userId: member.id, actorName: 'Owen Owner' }),
    )

    // Keep one other admin so the last admin can be demoted.
    await db
      .update(user)
      .set({ isAgencyAdmin: true })
      .where(eq(user.id, owner.id))
    await setAgencyAdmin(member.id, false, owner.id)
    const [revoked] = await db
      .select()
      .from(emailOutbox)
      .where(
        and(
          eq(emailOutbox.userId, member.id),
          eq(emailOutbox.kind, 'agency_admin_revoked'),
        ),
      )
    expect(revoked).toMatchObject({ status: 'queued' })
    await db
      .update(user)
      .set({ isAgencyAdmin: false })
      .where(eq(user.id, owner.id))
  })
})
