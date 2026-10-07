import { randomBytes } from 'node:crypto'
import { and, eq, gt, isNull } from 'drizzle-orm'

import { sendEmail } from '#/adapters/email'
import { db } from '#/db'
import { invitation, membership, organization, user } from '#/db/schema'
import { env } from '#/env'
import type { MembershipRole } from '#/lib/types'
import { m } from '#/paraglide/messages'
import { getBranding } from '#/server/admin/branding'
import { audit } from '#/server/audit'
import { ConflictError, NotFoundError } from '#/server/content/errors'
import { AppError } from '#/server/http/app-error'
import { collectSecretValues, createLogger, redactError } from '#/server/log'

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000

const log = createLogger('members')

/**
 * The invitation row exists (and can be resent or revoked) but the email did
 * not go out. A distinct 502 so the UI can tell it from a validation failure.
 */
export class InvitationDeliveryError extends AppError {
  readonly status = 502
  constructor(message = m.server_invitation_email_failed()) {
    super(message)
    this.name = 'InvitationDeliveryError'
  }
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/**
 * Serialises every owner-changing operation of one organization: concurrent
 * demotions/removals queue on the organization row, so the owner count read
 * afterwards is never stale.
 */
async function lockOrganization(tx: Tx, organizationId: string) {
  await tx
    .select({ id: organization.id })
    .from(organization)
    .where(eq(organization.id, organizationId))
    .for('update')
}

async function countOwners(tx: Tx, organizationId: string) {
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

export function assertAgencyAdminCanBeRemoved(adminCount: number) {
  if (adminCount <= 1) {
    throw new ConflictError(m.server_cannot_remove_last_agency_admin())
  }
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
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
  return db.transaction(async (tx) => {
    await lockOrganization(tx, organizationId)
    const [existing] = await tx
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
      throw new NotFoundError(m.server_member_not_found())
    }

    if (existing.role === 'owner' && role !== 'owner') {
      if ((await countOwners(tx, organizationId)) <= 1) {
        throw new ConflictError(m.server_cannot_demote_last_owner())
      }
    }

    const [updated] = await tx
      .update(membership)
      .set({ role })
      .where(eq(membership.id, existing.id))
      .returning()
    if (!updated) {
      throw new NotFoundError(m.server_member_not_found())
    }

    await audit(
      {
        organizationId,
        actorId,
        action: 'member.update_role',
        targetType: 'membership',
        targetId: existing.id,
        meta: { userId, role, previousRole: existing.role },
      },
      tx,
    )

    return updated
  })
}

export async function removeMember(
  organizationId: string,
  userId: string,
  actorId: string,
) {
  await db.transaction(async (tx) => {
    await lockOrganization(tx, organizationId)
    const [existing] = await tx
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
      throw new NotFoundError(m.server_member_not_found())
    }

    if (existing.role === 'owner') {
      if ((await countOwners(tx, organizationId)) <= 1) {
        throw new ConflictError(m.server_cannot_remove_last_owner())
      }
    }

    await tx.delete(membership).where(eq(membership.id, existing.id))

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
  })
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase()
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
    throw new NotFoundError(m.server_organization_not_found())
  }

  const email = normalizeEmail(input.email)

  const [existingUser] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, email))
    .limit(1)
  if (existingUser) {
    const [existingMember] = await db
      .select({ id: membership.id })
      .from(membership)
      .where(
        and(
          eq(membership.userId, existingUser.id),
          eq(membership.organizationId, input.organizationId),
        ),
      )
      .limit(1)
    if (existingMember) {
      throw new ConflictError(m.server_email_already_member())
    }
  }

  const [pending] = await db
    .select({ id: invitation.id })
    .from(invitation)
    .where(
      and(
        eq(invitation.organizationId, input.organizationId),
        eq(invitation.email, email),
        isNull(invitation.acceptedAt),
        gt(invitation.expiresAt, new Date()),
      ),
    )
    .limit(1)
  if (pending) {
    throw new ConflictError(m.server_invitation_pending())
  }

  const token = newInvitationToken()
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS)

  // Created as "failed" until SMTP accepts the message, so a crash between
  // the insert and the send leaves a row that can be resent, not a ghost.
  const created = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(invitation)
      .values({
        email,
        organizationId: input.organizationId,
        role: input.role,
        token,
        expiresAt,
        deliveryStatus: 'failed',
      })
      .returning()
    if (!row) {
      throw new Error(m.server_failed_to_create_invitation())
    }
    await audit(
      {
        organizationId: input.organizationId,
        actorId: input.actorId,
        action: 'member.invite',
        targetType: 'invitation',
        targetId: row.id,
        meta: { email, role: input.role },
      },
      tx,
    )
    return row
  })

  return deliverInvitation(created, org.name, input.email)
}

function newInvitationToken() {
  return randomBytes(32).toString('hex')
}

/**
 * Sends the invitation email and records the outcome on the row. On failure
 * the row is kept (marked failed) and an InvitationDeliveryError is thrown.
 */
async function deliverInvitation(
  row: typeof invitation.$inferSelect,
  organizationName: string,
  to: string,
) {
  try {
    const link = `${env.APP_URL}/invite/${row.token}`
    const brand = await getBranding()
    await sendEmail({
      to,
      fromName: brand.emailFromName ?? brand.appName,
      subject: m.server_invite_subject({ org: organizationName }),
      text: `${m.server_invite_body({ org: organizationName, role: row.role })}\n\n${m.server_invite_accept_text({ link })}\n\n— ${brand.appName}`,
      html: `<p>${m.server_invite_body({ org: organizationName, role: row.role })}</p><p><a href="${link}">${m.server_invite_accept()}</a></p><p style="color:#666;font-size:12px">— ${escapeHtml(brand.appName)}</p>`,
    })
  } catch (error) {
    // SMTP failures can echo the message body, including its bearer link.
    const safeError = redactError(error, [...collectSecretValues(), row.token])
    log.error('invitation email failed', {
      invitationId: row.id,
      organizationId: row.organizationId,
      err: safeError,
    })
    await db
      .update(invitation)
      .set({
        deliveryStatus: 'failed',
        lastDeliveryError: safeError.message.split('\n')[0].slice(0, 200),
      })
      .where(eq(invitation.id, row.id))
    throw new InvitationDeliveryError()
  }

  const [sent] = await db
    .update(invitation)
    .set({
      deliveryStatus: 'sent',
      lastDeliveryError: null,
      lastSentAt: new Date(),
    })
    .where(eq(invitation.id, row.id))
    .returning()
  return sent ?? row
}

export async function listInvitations(organizationId: string) {
  return db
    .select({
      id: invitation.id,
      email: invitation.email,
      organizationId: invitation.organizationId,
      role: invitation.role,
      token: invitation.token,
      expiresAt: invitation.expiresAt,
      acceptedAt: invitation.acceptedAt,
      deliveryStatus: invitation.deliveryStatus,
      lastSentAt: invitation.lastSentAt,
      createdAt: invitation.createdAt,
    })
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

export async function revokeInvitation(id: string, actorId: string) {
  const existing = await getInvitationById(id)
  if (!existing) {
    throw new NotFoundError(m.server_invitation_not_found())
  }

  await db.transaction(async (tx) => {
    await tx.delete(invitation).where(eq(invitation.id, id))
    await audit(
      {
        organizationId: existing.organizationId,
        actorId,
        action: 'invitation.revoke',
        targetType: 'invitation',
        targetId: id,
        meta: { email: existing.email },
      },
      tx,
    )
  })
}

/**
 * Sends the invitation again with a fresh token and a fresh expiry (works for
 * expired and delivery-failed invitations). The previous link stops working.
 */
export async function resendInvitation(id: string, actorId: string) {
  const { row, organizationName } = await db.transaction(async (tx) => {
    const [locked] = await tx
      .select()
      .from(invitation)
      .where(eq(invitation.id, id))
      .for('update')
    if (!locked) {
      throw new NotFoundError(m.server_invitation_not_found())
    }
    if (locked.acceptedAt) {
      throw new ConflictError(m.server_invitation_already_accepted())
    }

    const [org] = await tx
      .select({ name: organization.name })
      .from(organization)
      .where(eq(organization.id, locked.organizationId))
      .limit(1)
    if (!org) {
      throw new NotFoundError(m.server_organization_not_found())
    }

    const [alreadyMember] = await tx
      .select({ id: membership.id })
      .from(membership)
      .innerJoin(user, eq(membership.userId, user.id))
      .where(
        and(
          eq(membership.organizationId, locked.organizationId),
          eq(user.email, locked.email),
        ),
      )
      .limit(1)
    if (alreadyMember) {
      throw new ConflictError(m.server_email_already_member())
    }

    const [updated] = await tx
      .update(invitation)
      .set({
        token: newInvitationToken(),
        expiresAt: new Date(Date.now() + INVITE_TTL_MS),
        deliveryStatus: 'failed',
      })
      .where(eq(invitation.id, id))
      .returning()
    if (!updated) {
      throw new NotFoundError(m.server_invitation_not_found())
    }
    await audit(
      {
        organizationId: locked.organizationId,
        actorId,
        action: 'invitation.resend',
        targetType: 'invitation',
        targetId: id,
        meta: { email: locked.email },
      },
      tx,
    )
    return { row: updated, organizationName: org.name }
  })

  return deliverInvitation(row, organizationName, row.email)
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

export async function acceptInvitation(input: {
  token: string
  userId: string
}) {
  const invite = await getInvitation(input.token)
  if (!invite) {
    throw new NotFoundError(m.server_invitation_not_found())
  }

  const [invitee] = await db
    .select({ email: user.email })
    .from(user)
    .where(eq(user.id, input.userId))
    .limit(1)
  if (!invitee) {
    throw new NotFoundError(m.server_user_not_found())
  }
  if (normalizeEmail(invitee.email) !== normalizeEmail(invite.email)) {
    throw new ConflictError(m.server_invite_email_mismatch())
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

    await audit(
      {
        organizationId: invite.organizationId,
        actorId: input.userId,
        action: 'invitation.accept',
        targetType: 'invitation',
        targetId: invite.id,
        meta: { userId: input.userId },
      },
      tx,
    )
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

export async function setAgencyAdmin(
  userId: string,
  isAgencyAdmin: boolean,
  actorId: string,
) {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: user.id, isAgencyAdmin: user.isAgencyAdmin })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1)
    if (!existing) {
      throw new NotFoundError(m.server_user_not_found())
    }

    if (existing.isAgencyAdmin && !isAgencyAdmin) {
      const admins = await tx
        .select({ id: user.id })
        .from(user)
        .where(eq(user.isAgencyAdmin, true))
        .for('update')
      assertAgencyAdminCanBeRemoved(admins.length)
    }

    const [updated] = await tx
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
      throw new NotFoundError(m.server_user_not_found())
    }

    if (existing.isAgencyAdmin !== isAgencyAdmin) {
      await audit(
        {
          organizationId: null,
          actorId,
          action: isAgencyAdmin ? 'agency_admin.grant' : 'agency_admin.revoke',
          targetType: 'user',
          targetId: userId,
        },
        tx,
      )
    }

    return updated
  })
}

export async function listUsers() {
  const users = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      isAgencyAdmin: user.isAgencyAdmin,
      createdAt: user.createdAt,
    })
    .from(user)
    .orderBy(user.email)

  const membershipRows = await db
    .select({
      userId: membership.userId,
      organizationId: membership.organizationId,
      organizationName: organization.name,
      role: membership.role,
    })
    .from(membership)
    .innerJoin(organization, eq(membership.organizationId, organization.id))

  const membershipsByUser = new Map<
    string,
    Array<{
      organizationId: string
      organizationName: string
      role: MembershipRole
    }>
  >()

  for (const row of membershipRows) {
    const item = {
      organizationId: row.organizationId,
      organizationName: row.organizationName,
      role: row.role,
    }
    const list = membershipsByUser.get(row.userId)
    if (list) {
      list.push(item)
    } else {
      membershipsByUser.set(row.userId, [item])
    }
  }

  for (const list of membershipsByUser.values()) {
    list.sort((a, b) => a.organizationName.localeCompare(b.organizationName))
  }

  return users.map((row) => ({
    ...row,
    memberships: membershipsByUser.get(row.id) ?? [],
  }))
}
