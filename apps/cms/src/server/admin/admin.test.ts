import { createHash } from 'node:crypto'
import { eq, inArray } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { db } from '#/db'
import {
  auditLog,
  buildJob,
  collection,
  entry,
  entryRevision,
  membership,
  organization,
  publication,
  site,
  user,
} from '#/db/schema'
import { createEntry, publishEntry } from '#/server/content/entries'
import {
  createTestCollection,
  sampleRichText,
  withTestSite,
} from '#/server/content/test-utils'
import { requestPublication } from '#/server/publishing/publications'

import { listAuditLog } from './audit.ts'
import {
  acceptInvitation,
  inviteMember,
  listMembers,
  listUsers,
  removeMember,
  updateMemberRole,
} from './members.ts'
import {
  createOrganization,
  deleteOrganization,
  listOrganizations,
} from './organizations.ts'
import {
  createSite,
  deleteSite,
  rotateSiteTokenAdmin,
  updateSite,
} from './sites.ts'

const hasDb = Boolean(process.env.DATABASE_URL)

type MailpitAddress = { Address?: string }
type MailpitMessage = { To?: MailpitAddress[] }
type MailpitMessages = { messages?: MailpitMessage[] }

async function findMailpitMessage(email: string) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const res = await fetch(
      `${process.env.MAILPIT_URL ?? 'http://localhost:8025'}/api/v1/messages`,
    )
    if (res.ok) {
      const body = (await res.json()) as MailpitMessages
      const found = (body.messages ?? []).find((message) =>
        (message.To ?? []).some((to) => to.Address === email),
      )
      if (found) return found
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`Mailpit message for ${email} not found`)
}

async function createActor(suffix: string) {
  const [actor] = await db
    .insert(user)
    .values({
      id: crypto.randomUUID(),
      name: `Admin Actor ${suffix}`,
      email: `actor-${suffix}@test.local`,
      emailVerified: true,
    })
    .returning()
  if (!actor) throw new Error('Failed to create actor')
  return actor
}

async function cleanup(orgIds: string[], userIds: string[]) {
  if (orgIds.length > 0) {
    await db.delete(organization).where(inArray(organization.id, orgIds))
  }
  if (userIds.length > 0) {
    await db.delete(user).where(inArray(user.id, userIds))
  }
}

describe.skipIf(!hasDb)('admin', () => {
  it('creates and lists organizations and refuses delete when sites exist', async () => {
    const suffix = crypto.randomUUID()
    const actor = await createActor(suffix)
    const orgIds: string[] = []
    const userIds = [actor.id]

    try {
      const created = await createOrganization({
        name: `Admin Org ${suffix}`,
        slug: `admin-org-${suffix}`,
        actorId: actor.id,
      })
      orgIds.push(created.id)

      const listed = await listOrganizations()
      const found = listed.find((org) => org.id === created.id)
      expect(found).toMatchObject({
        id: created.id,
        name: created.name,
        slug: created.slug,
        siteCount: 0,
        memberCount: 0,
      })

      const empty = await createOrganization({
        name: `Empty Org ${suffix}`,
        slug: `empty-org-${suffix}`,
        actorId: actor.id,
      })
      await deleteOrganization(empty.id, actor.id)
      const afterDelete = await listOrganizations()
      expect(afterDelete.find((org) => org.id === empty.id)).toBeUndefined()

      const createdSite = await createSite({
        organizationId: created.id,
        name: `Admin Site ${suffix}`,
        slug: `admin-site-${suffix}`,
        productionUrl: 'https://example.test',
        actorId: actor.id,
      })
      expect(createdSite.organizationId).toBe(created.id)

      const afterSite = await listOrganizations()
      expect(afterSite.find((org) => org.id === created.id)?.siteCount).toBe(1)

      await expect(deleteOrganization(created.id, actor.id)).rejects.toThrow(
        'Cannot delete an organization that has sites',
      )
    } finally {
      await cleanup(orgIds, userIds)
    }
  })

  it('returns a plain site token whose sha256 matches tokenHash, rotates it, and validates deploymentTarget', async () => {
    const suffix = crypto.randomUUID()
    const actor = await createActor(suffix)
    const orgIds: string[] = []
    const userIds = [actor.id]

    try {
      const org = await createOrganization({
        name: `Token Org ${suffix}`,
        slug: `token-org-${suffix}`,
        actorId: actor.id,
      })
      orgIds.push(org.id)

      const created = await createSite({
        organizationId: org.id,
        name: `Token Site ${suffix}`,
        slug: `token-site-${suffix}`,
        productionUrl: 'https://token.example.test',
        actorId: actor.id,
      })

      expect(created.token).toMatch(/^[0-9a-f]{64}$/)
      expect(created).not.toHaveProperty('tokenHash')

      const [stored] = await db
        .select({ tokenHash: site.tokenHash })
        .from(site)
        .where(eq(site.id, created.id))
        .limit(1)
      expect(stored?.tokenHash).toBe(
        createHash('sha256').update(created.token).digest('hex'),
      )

      const rotated = await rotateSiteTokenAdmin(created.id, 'build', actor.id)
      expect(rotated.token).not.toBe(created.token)

      const [afterRotate] = await db
        .select({ tokenHash: site.tokenHash })
        .from(site)
        .where(eq(site.id, created.id))
        .limit(1)
      expect(afterRotate?.tokenHash).toBe(
        createHash('sha256').update(rotated.token).digest('hex'),
      )
      expect(afterRotate?.tokenHash).not.toBe(stored?.tokenHash)

      const updated = await updateSite(
        created.id,
        {
          deploymentTarget: {
            provider: 'dokploy',
            applicationId: 'app-1',
            healthCheckUrl: 'https://token.example.test/health',
          },
        },
        actor.id,
      )
      expect(updated.deploymentTarget).toEqual({
        provider: 'dokploy',
        applicationId: 'app-1',
        healthCheckUrl: 'https://token.example.test/health',
      })

      await expect(
        updateSite(
          created.id,
          {
            deploymentTarget: {
              provider: 'vercel',
              applicationId: 'nope',
            } as never,
          },
          actor.id,
        ),
      ).rejects.toThrow()
    } finally {
      await cleanup(orgIds, userIds)
    }
  })

  it('invites a member by email, accepts, and refuses removing the last owner', async () => {
    const suffix = crypto.randomUUID()
    const actor = await createActor(suffix)
    const [invitee] = await db
      .insert(user)
      .values({
        id: crypto.randomUUID(),
        name: `Invitee ${suffix}`,
        email: `invitee-${suffix}@test.local`,
        emailVerified: true,
      })
      .returning()
    if (!invitee) throw new Error('Failed to create invitee')

    const orgIds: string[] = []
    const userIds = [actor.id, invitee.id]
    const inviteEmail = invitee.email

    try {
      const org = await createOrganization({
        name: `Invite Org ${suffix}`,
        slug: `invite-org-${suffix}`,
        actorId: actor.id,
      })
      orgIds.push(org.id)

      const invitation = await inviteMember({
        organizationId: org.id,
        email: inviteEmail,
        role: 'owner',
        actorId: actor.id,
      })
      expect(invitation.token).toMatch(/^[0-9a-f]{64}$/)

      const message = await findMailpitMessage(inviteEmail)
      expect(message).toBeDefined()

      await acceptInvitation({ token: invitation.token, userId: invitee.id })

      const members = await listMembers(org.id)
      expect(members).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            userId: invitee.id,
            role: 'owner',
            email: invitee.email,
          }),
        ]),
      )

      await expect(removeMember(org.id, invitee.id, actor.id)).rejects.toThrow(
        'Cannot remove the last owner',
      )
      await expect(
        updateMemberRole(org.id, invitee.id, 'editor', actor.id),
      ).rejects.toThrow('Cannot demote the last owner')
    } finally {
      await cleanup(orgIds, userIds)
    }
  })

  it('rejects duplicate invites, existing members, and email-mismatched accepts', async () => {
    const suffix = crypto.randomUUID()
    const actor = await createActor(suffix)
    const [invitee] = await db
      .insert(user)
      .values({
        id: crypto.randomUUID(),
        name: `Invitee ${suffix}`,
        email: `invitee-${suffix}@test.local`,
        emailVerified: true,
      })
      .returning()
    if (!invitee) throw new Error('Failed to create invitee')

    const [stranger] = await db
      .insert(user)
      .values({
        id: crypto.randomUUID(),
        name: `Stranger ${suffix}`,
        email: `stranger-${suffix}@test.local`,
        emailVerified: true,
      })
      .returning()
    if (!stranger) throw new Error('Failed to create stranger')

    const orgIds: string[] = []
    const userIds = [actor.id, invitee.id, stranger.id]
    const inviteEmail = invitee.email

    try {
      const org = await createOrganization({
        name: `Invite Edge Org ${suffix}`,
        slug: `invite-edge-org-${suffix}`,
        actorId: actor.id,
      })
      orgIds.push(org.id)

      const first = await inviteMember({
        organizationId: org.id,
        email: inviteEmail.toUpperCase(),
        role: 'editor',
        actorId: actor.id,
      })
      expect(first.email).toBe(inviteEmail)

      await expect(
        inviteMember({
          organizationId: org.id,
          email: inviteEmail,
          role: 'editor',
          actorId: actor.id,
        }),
      ).rejects.toThrow('An invitation is already pending for this email')

      await expect(
        acceptInvitation({ token: first.token, userId: stranger.id }),
      ).rejects.toThrow('Signed-in email does not match this invitation')

      await acceptInvitation({ token: first.token, userId: invitee.id })

      await expect(
        inviteMember({
          organizationId: org.id,
          email: inviteEmail,
          role: 'editor',
          actorId: actor.id,
        }),
      ).rejects.toThrow('This email is already a member')
    } finally {
      await cleanup(orgIds, userIds)
    }
  })

  it('lists users with memberships grouped and sorted by organization name', async () => {
    const suffix = crypto.randomUUID()
    const actor = await createActor(suffix)
    const [member] = await db
      .insert(user)
      .values({
        id: crypto.randomUUID(),
        name: `Member ${suffix}`,
        email: `member-${suffix}@test.local`,
        emailVerified: true,
      })
      .returning()
    if (!member) throw new Error('Failed to create member')

    const [loner] = await db
      .insert(user)
      .values({
        id: crypto.randomUUID(),
        name: `Loner ${suffix}`,
        email: `loner-${suffix}@test.local`,
        emailVerified: true,
      })
      .returning()
    if (!loner) throw new Error('Failed to create loner')

    const orgIds: string[] = []
    const userIds = [actor.id, member.id, loner.id]

    try {
      const zeta = await createOrganization({
        name: `Zeta Org ${suffix}`,
        slug: `zeta-org-${suffix}`,
        actorId: actor.id,
      })
      const alpha = await createOrganization({
        name: `Alpha Org ${suffix}`,
        slug: `alpha-org-${suffix}`,
        actorId: actor.id,
      })
      orgIds.push(zeta.id, alpha.id)

      await db.insert(membership).values([
        {
          userId: member.id,
          organizationId: zeta.id,
          role: 'editor',
        },
        {
          userId: member.id,
          organizationId: alpha.id,
          role: 'owner',
        },
      ])

      const listed = await listUsers()
      const foundMember = listed.find((row) => row.id === member.id)
      const foundLoner = listed.find((row) => row.id === loner.id)

      expect(foundMember).toMatchObject({
        id: member.id,
        name: member.name,
        email: member.email,
        isAgencyAdmin: false,
      })
      expect(foundMember?.memberships).toEqual([
        {
          organizationId: alpha.id,
          organizationName: alpha.name,
          role: 'owner',
        },
        {
          organizationId: zeta.id,
          organizationName: zeta.name,
          role: 'editor',
        },
      ])
      expect(foundLoner?.memberships).toEqual([])
    } finally {
      await cleanup(orgIds, userIds)
    }
  })

  it('lists audit log entries with the actor name', async () => {
    const suffix = crypto.randomUUID()
    const actor = await createActor(suffix)
    const orgIds: string[] = []
    const userIds = [actor.id]

    try {
      const org = await createOrganization({
        name: `Audit Org ${suffix}`,
        slug: `audit-org-${suffix}`,
        actorId: actor.id,
      })
      orgIds.push(org.id)

      const entries = await listAuditLog({
        organizationId: org.id,
        limit: 20,
        offset: 0,
      })

      expect(entries.length).toBeGreaterThan(0)
      expect(entries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            organizationId: org.id,
            actorId: actor.id,
            actorName: actor.name,
            action: 'organization.create',
            targetType: 'organization',
            targetId: org.id,
          }),
        ]),
      )
    } finally {
      await cleanup(orgIds, userIds)
    }
  })

  it('cascades site-scoped rows when deleting a site', async () => {
    await withTestSite(async (ctx) => {
      await updateSite(ctx.site.id, { publishingMode: 'demo' }, ctx.actor.id)
      await createTestCollection(ctx.site.id)
      const created = await createEntry({
        siteId: ctx.site.id,
        collectionKey: 'articles',
        data: {
          title: 'To delete',
          slug: `del-${ctx.suffix}`,
          body: sampleRichText,
        },
        actorId: ctx.actor.id,
      })
      await publishEntry(created.id, ctx.actor.id)
      const requested = await requestPublication({
        siteId: ctx.site.id,
        actorId: ctx.actor.id,
      })
      expect(requested.ok).toBe(true)

      // Completed historical jobs may cascade; queued work must block deletion.
      await expect(deleteSite(ctx.site.id, ctx.actor.id)).rejects.toThrow(
        'pending releases',
      )
      await db
        .update(buildJob)
        .set({
          status: 'succeeded',
          dispatchUncertain: false,
          finishedAt: new Date(),
        })
        .where(eq(buildJob.siteId, ctx.site.id))
      const entryId = created.id
      await deleteSite(ctx.site.id, ctx.actor.id)

      expect(
        (await db.select().from(site).where(eq(site.id, ctx.site.id))).length,
      ).toBe(0)
      expect(
        (
          await db
            .select()
            .from(collection)
            .where(eq(collection.siteId, ctx.site.id))
        ).length,
      ).toBe(0)
      expect(
        (await db.select().from(entry).where(eq(entry.siteId, ctx.site.id)))
          .length,
      ).toBe(0)
      expect(
        (
          await db
            .select()
            .from(entryRevision)
            .where(eq(entryRevision.entryId, entryId))
        ).length,
      ).toBe(0)
      expect(
        (
          await db
            .select()
            .from(publication)
            .where(eq(publication.siteId, ctx.site.id))
        ).length,
      ).toBe(0)
      expect(
        (
          await db
            .select()
            .from(buildJob)
            .where(eq(buildJob.siteId, ctx.site.id))
        ).length,
      ).toBe(0)

      const leftoverAudit = await db
        .select()
        .from(auditLog)
        .where(eq(auditLog.siteId, ctx.site.id))
      expect(leftoverAudit).toHaveLength(0)
    })
  })
})
