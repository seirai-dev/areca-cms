/**
 * Memberships: who belongs to a client and with which role. Invitations live
 * in `invitations.ts`, the agency admin role in `agency-admins.ts` and the
 * people list in `user-directory.ts`.
 */
import { and, eq } from 'drizzle-orm'

import { db } from '#/db'
import type { Tx } from '#/db'
import { membership, organization, site, user } from '#/db/schema'
import type { MembershipRole } from '#/lib/types'
import { m } from '#/paraglide/messages'
import { audit } from '#/server/audit'
import { ConflictError, NotFoundError } from '#/server/content/errors'
import { sendAccountEmail } from '#/server/mail/account-emails'
import { cancelQueuedNotificationEmails } from '#/server/mail/outbox'
import { revokeMemberMcpConnections } from '#/server/mcp/connections'
import { revokeMemberMcpKeys } from '#/server/mcp/keys'

import { lockOrganizationForMutation } from './organization-lock'

export async function countOwners(tx: Tx, organizationId: string) {
  const owners = await tx
    .select({ id: membership.id })
    .from(membership)
    .where(
      and(
        eq(membership.organizationId, organizationId),
        eq(membership.role, 'owner'),
      ),
    )
  return owners.length
}

export async function listMembers(organizationId: string) {
  return db
    .select({
      id: membership.id,
      userId: membership.userId,
      organizationId: membership.organizationId,
      role: membership.role,
      createdAt: membership.createdAt,
      name: user.name,
      email: user.email,
    })
    .from(membership)
    .innerJoin(user, eq(membership.userId, user.id))
    .where(eq(membership.organizationId, organizationId))
    .orderBy(user.email)
}

export async function updateMemberRole(
  organizationId: string,
  userId: string,
  role: MembershipRole,
  actorId: string,
) {
  return db.transaction((tx) =>
    applyMemberRole(tx, { organizationId, userId, role, actorId }),
  )
}

/**
 * Changes one membership's role inside the caller's transaction: last-owner
 * protection, the audit row and the role-change email. Shared by the single
 * change above and the batch client access on a person's page.
 */
export async function applyMemberRole(
  tx: Tx,
  input: {
    organizationId: string
    userId: string
    role: MembershipRole
    actorId: string
  },
) {
  const { organizationId, userId, role, actorId } = input
  await lockOrganizationForMutation(tx, organizationId)
  const existing = (
    await tx
      .select()
      .from(membership)
      .where(
        and(
          eq(membership.organizationId, organizationId),
          eq(membership.userId, userId),
        ),
      )
      .limit(1)
  ).at(0)
  if (!existing) {
    throw new NotFoundError(m.server_member_not_found())
  }

  if (existing.role === 'owner' && role !== 'owner') {
    if ((await countOwners(tx, organizationId)) <= 1) {
      throw new ConflictError(
        m.server_cannot_demote_last_owner_of({
          org: await organizationName(tx, organizationId),
        }),
      )
    }
  }

  const updated = (
    await tx
      .update(membership)
      .set({ role })
      .where(eq(membership.id, existing.id))
      .returning()
  ).at(0)
  if (!updated) {
    throw new NotFoundError(m.server_member_not_found())
  }

  // The name is kept in the row, so the activity log still names the person
  // after they are renamed or deleted.
  const person = (
    await tx
      .select({ name: user.name })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1)
  ).at(0)
  await audit(
    {
      organizationId,
      actorId,
      action: 'member.update_role',
      targetType: 'membership',
      targetId: existing.id,
      meta: {
        userId,
        userName: person?.name ?? null,
        role,
        previousRole: existing.role,
      },
    },
    tx,
  )

  // Changing your own role needs no email.
  if (existing.role !== role && actorId !== userId) {
    await sendAccountEmail({
      kind: 'membership_role_changed',
      userId,
      params: {
        userId,
        organizationId,
        role,
        previousRole: existing.role,
      },
      connection: tx,
    })
  }

  return updated
}

async function organizationName(tx: Tx, organizationId: string) {
  const org = (
    await tx
      .select({ name: organization.name })
      .from(organization)
      .where(eq(organization.id, organizationId))
      .limit(1)
  ).at(0)
  return org?.name ?? ''
}

export async function removeMember(
  organizationId: string,
  userId: string,
  actorId: string,
) {
  await db.transaction((tx) =>
    applyMemberRemoval(tx, { organizationId, userId, actorId }),
  )
}

/**
 * Removes one membership inside the caller's transaction: last-owner
 * protection, MCP and queued-notice cleanup, the audit rows and the removal
 * email. Shared by `removeMember` and the batch client access.
 */
export async function applyMemberRemoval(
  tx: Tx,
  input: { organizationId: string; userId: string; actorId: string },
) {
  const { organizationId, userId, actorId } = input
  await lockOrganizationForMutation(tx, organizationId)
  const existing = (
    await tx
      .select()
      .from(membership)
      .where(
        and(
          eq(membership.organizationId, organizationId),
          eq(membership.userId, userId),
        ),
      )
      .limit(1)
  ).at(0)
  if (!existing) {
    throw new NotFoundError(m.server_member_not_found())
  }

  if (existing.role === 'owner') {
    if ((await countOwners(tx, organizationId)) <= 1) {
      throw new ConflictError(
        m.server_cannot_remove_last_owner_of({
          org: await organizationName(tx, organizationId),
        }),
      )
    }
  }

  // Read before the delete so the email can still name the organization.
  const org = (
    await tx
      .select({ name: organization.name })
      .from(organization)
      .where(eq(organization.id, organizationId))
      .limit(1)
  ).at(0)
  const actor = (
    await tx
      .select({ name: user.name })
      .from(user)
      .where(eq(user.id, actorId))
      .limit(1)
  ).at(0)

  await tx.delete(membership).where(eq(membership.id, existing.id))

  // Leaving also ends what the membership granted: personal MCP keys and app
  // connections on the organization's sites, and queued notices meant for it.
  // Revoked keys stay revoked, so a rejoin needs new ones.
  const siteRows = await tx
    .select({ id: site.id })
    .from(site)
    .where(eq(site.organizationId, organizationId))
  const siteIds = siteRows.map((row) => row.id)
  const mcpKeysRevoked = await revokeMemberMcpKeys(tx, { userId, siteIds })
  const mcpConnectionsRevoked = await revokeMemberMcpConnections(tx, {
    userId,
    siteIds,
  })
  const notificationsCancelled = await cancelQueuedNotificationEmails(
    userId,
    organizationId,
    tx,
  )

  await audit(
    {
      organizationId,
      actorId,
      action: 'member.remove',
      targetType: 'membership',
      targetId: existing.id,
      meta: { userId },
    },
    tx,
  )
  await audit(
    {
      organizationId,
      actorId,
      action: 'member.mcp_access_revoke',
      targetType: 'membership',
      targetId: existing.id,
      meta: {
        userId,
        mcpKeysRevoked,
        mcpConnectionsRevoked,
        notificationsCancelled,
      },
    },
    tx,
  )

  // Leaving on your own needs no email.
  if (actorId !== userId) {
    await sendAccountEmail({
      kind: 'membership_removed',
      userId,
      params: {
        userId,
        orgName: org?.name ?? '',
        actorName: actor?.name ?? '',
      },
      connection: tx,
    })
  }
}
