import { randomBytes } from 'node:crypto'
import { and, eq, gt, isNull } from 'drizzle-orm'

import { sendEmail } from '#/adapters/email'
import { db } from '#/db'
import { invitation, membership, organization, user } from '#/db/schema'
import { env } from '#/env'
import type { MembershipRole } from '#/lib/types'
import { audit } from '#/server/audit'
import { ConflictError, NotFoundError } from '#/server/content/errors'

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000

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
) {
  const [existing] = await db
    .select()
    .from(membership)
    .where(
      and(
        eq(membership.organizationId, organizationId),
        eq(membership.userId, userId),
      ),
    )
    .limit(1)
  if (!existing) {
    throw new NotFoundError('Member not found')
  }

  if (existing.role === 'owner' && role !== 'owner') {
    const owners = await db
      .select({ id: membership.id })
      .from(membership)
      .where(
        and(
          eq(membership.organizationId, organizationId),
          eq(membership.role, 'owner'),
        ),
      )
    if (owners.length <= 1) {
      throw new ConflictError('Cannot demote the last owner')
    }
  }

  const [updated] = await db
    .update(membership)
    .set({ role })
    .where(eq(membership.id, existing.id))
    .returning()
  if (!updated) {
    throw new NotFoundError('Member not found')
  }

  await audit({
    organizationId,
    action: 'member.update_role',
    targetType: 'membership',
    targetId: existing.id,
    meta: { userId, role },
  })

  return updated
}

export async function removeMember(organizationId: string, userId: string) {
  const [existing] = await db
    .select()
    .from(membership)
    .where(
      and(
        eq(membership.organizationId, organizationId),
        eq(membership.userId, userId),
      ),
    )
    .limit(1)
  if (!existing) {
    throw new NotFoundError('Member not found')
  }

  if (existing.role === 'owner') {
    const owners = await db
      .select({ id: membership.id })
      .from(membership)
      .where(
        and(
          eq(membership.organizationId, organizationId),
          eq(membership.role, 'owner'),
        ),
      )
    if (owners.length <= 1) {
      throw new ConflictError('Cannot remove the last owner')
    }
  }

  await db.delete(membership).where(eq(membership.id, existing.id))

  await audit({
    organizationId,
    action: 'member.remove',
    targetType: 'membership',
    targetId: existing.id,
    meta: { userId },
  })
}

export async function inviteMember(input: {
  organizationId: string
  email: string
  role: MembershipRole
  actorId: string
}) {
  const [org] = await db
    .select()
    .from(organization)
    .where(eq(organization.id, input.organizationId))
    .limit(1)
  if (!org) {
    throw new NotFoundError('Organization not found')
  }

  const token = randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS)

  const [created] = await db
    .insert(invitation)
    .values({
      email: input.email,
      organizationId: input.organizationId,
      role: input.role,
      token,
      expiresAt,
    })
    .returning()
  if (!created) {
    throw new Error('Failed to create invitation')
  }

  const link = `${env.APP_URL}/invite/${token}`
  await sendEmail({
    to: input.email,
    subject: `Invitation to ${org.name}`,
    text: `You have been invited to ${org.name} as ${input.role}.\n\nAccept: ${link}`,
    html: `<p>You have been invited to ${org.name} as ${input.role}.</p><p><a href="${link}">Accept invitation</a></p>`,
  })

  await audit({
    organizationId: input.organizationId,
    actorId: input.actorId,
    action: 'member.invite',
    targetType: 'invitation',
    targetId: created.id,
    meta: { email: input.email, role: input.role },
  })

  return created
}

export async function listInvitations(organizationId: string) {
  return db
    .select()
    .from(invitation)
    .where(eq(invitation.organizationId, organizationId))
    .orderBy(invitation.createdAt)
}

export async function getInvitationById(id: string) {
  const [row] = await db
    .select()
    .from(invitation)
    .where(eq(invitation.id, id))
    .limit(1)
  return row ?? null
}

export async function revokeInvitation(id: string) {
  const existing = await getInvitationById(id)
  if (!existing) {
    throw new NotFoundError('Invitation not found')
  }

  await db.delete(invitation).where(eq(invitation.id, id))

  await audit({
    organizationId: existing.organizationId,
    action: 'invitation.revoke',
    targetType: 'invitation',
    targetId: id,
  })
}

export async function getInvitation(token: string) {
  const [row] = await db
    .select()
    .from(invitation)
    .where(
      and(
        eq(invitation.token, token),
        isNull(invitation.acceptedAt),
        gt(invitation.expiresAt, new Date()),
      ),
    )
    .limit(1)
  return row ?? null
}

export async function acceptInvitation(input: { token: string; userId: string }) {
  const invite = await getInvitation(input.token)
  if (!invite) {
    throw new NotFoundError('Invitation not found')
  }

  const acceptedAt = new Date()

  await db.transaction(async (tx) => {
    const [existingMember] = await tx
      .select({ id: membership.id })
      .from(membership)
      .where(
        and(
          eq(membership.userId, input.userId),
          eq(membership.organizationId, invite.organizationId),
        ),
      )
      .limit(1)

    if (!existingMember) {
      await tx.insert(membership).values({
        userId: input.userId,
        organizationId: invite.organizationId,
        role: invite.role,
      })
    }

    await tx
      .update(invitation)
      .set({ acceptedAt })
      .where(eq(invitation.id, invite.id))
  })

  await audit({
    organizationId: invite.organizationId,
    actorId: input.userId,
    action: 'invitation.accept',
    targetType: 'invitation',
    targetId: invite.id,
    meta: { userId: input.userId },
  })

  return { organizationId: invite.organizationId, role: invite.role }
}

export async function listAgencyAdmins() {
  return db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      isAgencyAdmin: user.isAgencyAdmin,
    })
    .from(user)
    .where(eq(user.isAgencyAdmin, true))
    .orderBy(user.email)
}

export async function setAgencyAdmin(userId: string, isAgencyAdmin: boolean) {
  const [existing] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1)
  if (!existing) {
    throw new NotFoundError('User not found')
  }

  const [updated] = await db
    .update(user)
    .set({ isAgencyAdmin, updatedAt: new Date() })
    .where(eq(user.id, userId))
    .returning({
      id: user.id,
      name: user.name,
      email: user.email,
      isAgencyAdmin: user.isAgencyAdmin,
    })
  if (!updated) {
    throw new NotFoundError('User not found')
  }

  return updated
}

export async function listUsers() {
  return db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      isAgencyAdmin: user.isAgencyAdmin,
      createdAt: user.createdAt,
    })
    .from(user)
    .orderBy(user.email)
}
