/* eslint-disable @typescript-eslint/no-unnecessary-condition -- Drizzle row arrays can be empty; retain defensive lookup and authorization checks. */
import { randomBytes } from 'node:crypto'
import { and, eq, gt, isNull, like, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'

import { db } from '#/db'
import {
  invitation,
  membership,
  organization,
  site,
  user,
  verification,
} from '#/db/schema'
import type { MembershipRole } from '#/lib/types'
import { m } from '#/paraglide/messages'
import { getLocale } from '#/paraglide/runtime'
import { audit } from '#/server/audit'
import { ConflictError, NotFoundError } from '#/server/content/errors'
import { AppError } from '#/server/http/app-error'
import { lastActiveSubquery } from './last-active'
import { sendAccountEmail } from '#/server/mail/account-emails'
import { mailFailureMessage } from '#/server/mail/errors'
import {
  cancelQueuedNotificationEmails,
  enqueueEmail,
  sendNow,
  supersedeInvitationEmails,
} from '#/server/mail/outbox'
import type { EnqueuedEmail } from '#/server/mail/outbox'
import { invitationAcceptUrl } from '#/server/mail/render/templates/invitation'
import { PARAMS_SECRET_CONTEXT } from '#/server/mail/render/templates/password-reset'
import { revokeMemberMcpConnections } from '#/server/mcp/connections'
import { revokeMemberMcpKeys } from '#/server/mcp/keys'
import { notifyInviteAccepted } from '#/server/notifications/triggers'

import {
  assertAgencyAdminCanBeRemoved,
  countActiveAgencyAdmins,
  lockAgencyAdminRoster,
} from './agency-admin-roster.ts'
import { encryptSecret } from '#/server/security/secret-encryption'
import { secretsEncryptionKey } from '#/server/security/secrets-key'
import { hashToken } from '#/server/security/token-hash'

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Invitation columns that may leave the server. The token hash never does, and
 * the raw token is only ever in the email or in a regenerate response.
 */
const INVITATION_COLUMNS = {
  id: invitation.id,
  email: invitation.email,
  organizationId: invitation.organizationId,
  role: invitation.role,
  expiresAt: invitation.expiresAt,
  acceptedAt: invitation.acceptedAt,
  deliveryStatus: invitation.deliveryStatus,
  lastSentAt: invitation.lastSentAt,
  createdAt: invitation.createdAt,
}

/**
 * The invitation row exists (and can be resent or revoked) but the email did
 * not go out yet or at all. `reason` is the readable mail error. A distinct
 * 502 so the UI can tell it from a validation failure.
 */
export class InvitationDeliveryError extends AppError {
  readonly status = 502
  /** The readable mail failure on its own. */
  readonly reason: string
  constructor(reason = '') {
    super(
      reason
        ? `${m.server_invitation_email_failed()} ${reason}`
        : m.server_invitation_email_failed(),
    )
    this.name = 'InvitationDeliveryError'
    this.reason = reason
  }
}

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/**
 * Serialises every owner-changing operation of one organization: concurrent
 * demotions/removals queue on the organization row, so the owner count read
 * afterwards is never stale.
 */
export async function lockOrganization(tx: Tx, organizationId: string) {
  await tx
    .select({ id: organization.id })
    .from(organization)
    .where(eq(organization.id, organizationId))
    .for('update')
}

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

export {
  LastAgencyAdminError,
  assertAgencyAdminCanBeRemoved,
  countActiveAgencyAdmins,
  lockAgencyAdminRoster,
} from './agency-admin-roster.ts'

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
      throw new ConflictError(
        m.server_cannot_demote_last_owner_of({
          org: await organizationName(tx, organizationId),
        }),
      )
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

  // The name is kept in the row, so the activity log still names the person
  // after they are renamed or deleted.
  const [person] = await tx
    .select({ name: user.name })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1)
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
  const [org] = await tx
    .select({ name: organization.name })
    .from(organization)
    .where(eq(organization.id, organizationId))
    .limit(1)
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
      throw new ConflictError(
        m.server_cannot_remove_last_owner_of({
          org: await organizationName(tx, organizationId),
        }),
      )
    }
  }

  // Read before the delete so the email can still name the organization.
  const [org] = await tx
    .select({ name: organization.name })
    .from(organization)
    .where(eq(organization.id, organizationId))
    .limit(1)
  const [actor] = await tx
    .select({ name: user.name })
    .from(user)
    .where(eq(user.id, actorId))
    .limit(1)

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

  const created = await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${JSON.stringify(['invitation', input.organizationId, email])}, 0))`,
    )
    const [existingUser] = await tx
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, email))
      .limit(1)
    if (existingUser) {
      const [existingMember] = await tx
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

    const [pending] = await tx
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

    const { token, tokenHash } = newInvitationToken()
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS)

    // Queued in the same transaction, so the invitation and its email are
    // stored together. A crash before the send leaves a row the worker sends.
    const [row] = await tx
      .insert(invitation)
      .values({
        email,
        organizationId: input.organizationId,
        role: input.role,
        tokenHash,
        expiresAt,
        deliveryStatus: 'queued',
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
    const outbox = await enqueueInvitation(tx, row, token)
    return { row, outbox, token }
  })

  return sendInvitation(created.row.id, created.outbox, created.token)
}

/**
 * A new invitation token and its hash. The raw token lives in memory only:
 * the email carries it, and regenerate returns it once.
 */
function newInvitationToken() {
  const token = randomBytes(32).toString('hex')
  return { token, tokenHash: hashToken(token) }
}

/**
 * Queues the invitation email in the caller's transaction. The outbox never
 * holds the link in plain text: `encryptedToken` is stored only when a secrets
 * key exists, so a retry can rebuild it. The plain token is a render param,
 * used for the subject and the immediate send, and is not stored. The row is
 * inserted already claimed: `sendInvitation` sends it right after the commit.
 */
async function enqueueInvitation(
  tx: Tx,
  row: typeof invitation.$inferSelect,
  token: string,
) {
  const key = secretsEncryptionKey()
  return enqueueEmail(
    {
      kind: 'invitation',
      template: 'invitation',
      to: row.email,
      params: {
        invitationId: row.id,
        ...(key
          ? { encryptedToken: encryptSecret(token, key, PARAMS_SECRET_CONTEXT) }
          : {}),
      },
      renderParams: { token },
      locale: getLocale(),
      organizationId: row.organizationId,
      immediate: true,
    },
    tx,
  )
}

/**
 * Sends the queued invitation email now. The outbox writes the outcome onto
 * the invitation row. Anything but "sent" throws with the readable reason; the
 * row is kept, so it can be resent or left to the worker's retries.
 */
async function sendInvitation(
  invitationId: string,
  outbox: EnqueuedEmail,
  token: string,
) {
  const result = await sendNow(outbox.id, {
    renderParams: { token },
    claimedAttempt: outbox.claimedAttempt,
  })
  if (result.status !== 'sent') {
    throw new InvitationDeliveryError(mailFailureMessage(result.failure))
  }
  const [row] = await db
    .select(INVITATION_COLUMNS)
    .from(invitation)
    .where(eq(invitation.id, invitationId))
    .limit(1)
  if (!row) throw new NotFoundError(m.server_invitation_not_found())
  return row
}

export async function listInvitations(organizationId: string) {
  return db
    .select(INVITATION_COLUMNS)
    .from(invitation)
    .where(eq(invitation.organizationId, organizationId))
    .orderBy(invitation.createdAt)
}

export async function getInvitationById(id: string) {
  const row = (
    await db.select().from(invitation).where(eq(invitation.id, id)).limit(1)
  ).at(0)
  return row ?? null
}

export async function revokeInvitation(id: string, actorId: string) {
  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(invitation)
      .where(eq(invitation.id, id))
      .for('update')
    if (!existing) throw new NotFoundError(m.server_invitation_not_found())
    if (existing.acceptedAt)
      throw new ConflictError(m.server_invitation_already_accepted())
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
  const { row, outbox, token } = await reissueInvitation(
    id,
    actorId,
    'invitation.resend',
  )
  return sendInvitation(row.id, outbox, token)
}

/**
 * "Regenerate link": a fresh token, so the old link stops working, and the
 * invitation email with the new link. The link is returned once for the admin
 * to copy. When the email cannot go out, the link is still returned, with the
 * reason, because the admin may share it another way.
 */
export async function regenerateInvitationLink(id: string, actorId: string) {
  const { row, outbox, token } = await reissueInvitation(
    id,
    actorId,
    'invitation.regenerate_link',
  )
  const link = invitationAcceptUrl(token)
  try {
    await sendInvitation(row.id, outbox, token)
    return { link, emailSent: true, emailError: null }
  } catch (error) {
    if (!(error instanceof InvitationDeliveryError)) throw error
    return { link, emailSent: false, emailError: error.reason }
  }
}

/**
 * Stores a new token hash and expiry, queues the email for it and writes the
 * audit entry, in one transaction. Callers send the email afterwards.
 */
async function reissueInvitation(
  id: string,
  actorId: string,
  action: 'invitation.resend' | 'invitation.regenerate_link',
) {
  return db.transaction(async (tx) => {
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
      .select({ id: organization.id })
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

    const { token, tokenHash } = newInvitationToken()
    const [updated] = await tx
      .update(invitation)
      .set({
        tokenHash,
        expiresAt: new Date(Date.now() + INVITE_TTL_MS),
        deliveryStatus: 'queued',
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
        action,
        targetType: 'invitation',
        targetId: id,
        meta: { email: locked.email },
      },
      tx,
    )
    // The new link replaces the old one, so older queued sends must not go out.
    await supersedeInvitationEmails(updated.id, tx)
    const outbox = await enqueueInvitation(tx, updated, token)
    return { row: updated, outbox, token }
  })
}

export async function getInvitation(token: string) {
  const [row] = await db
    .select()
    .from(invitation)
    .where(
      and(
        eq(invitation.tokenHash, hashToken(token)),
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
  const tokenHash = hashToken(input.token)
  // Read only the tuple identity first. Re-read the invitation under both
  // locks, so revocation/acceptance cannot make this snapshot authoritative.
  const [identity] = await db
    .select({
      organizationId: invitation.organizationId,
      email: invitation.email,
    })
    .from(invitation)
    .where(eq(invitation.tokenHash, tokenHash))
    .limit(1)
  if (!identity) throw new NotFoundError(m.server_invitation_not_found())
  // Set only when this call accepted the invitation (replays notify nobody).
  const newlyAccepted = { invitationId: null as string | null }
  const result = await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${JSON.stringify(['invitation', identity.organizationId, normalizeEmail(identity.email)])}, 0))`,
    )
    const [invite] = await tx
      .select()
      .from(invitation)
      .where(eq(invitation.tokenHash, tokenHash))
      .for('update')
    if (
      !invite ||
      (!invite.acceptedAt && invite.expiresAt.getTime() <= Date.now())
    )
      throw new NotFoundError(m.server_invitation_not_found())
    const [invitee] = await tx
      .select({ email: user.email })
      .from(user)
      .where(eq(user.id, input.userId))
      .limit(1)
    if (!invitee) throw new NotFoundError(m.server_user_not_found())
    if (normalizeEmail(invitee.email) !== normalizeEmail(invite.email)) {
      if (invite.acceptedAt)
        throw new NotFoundError(m.server_invitation_not_found())
      throw new ConflictError(m.server_invite_email_mismatch())
    }
    const [existingMember] = await tx
      .select()
      .from(membership)
      .where(
        and(
          eq(membership.userId, input.userId),
          eq(membership.organizationId, invite.organizationId),
        ),
      )
      .limit(1)
    // A consumed link can reopen an existing membership, never restore one
    // that an owner removed later.
    if (invite.acceptedAt) {
      if (!existingMember)
        throw new NotFoundError(m.server_invitation_not_found())
      return {
        organizationId: invite.organizationId,
        role: existingMember.role,
      }
    }
    if (invite.expiresAt.getTime() <= Date.now()) {
      throw new NotFoundError(m.server_invitation_not_found())
    }
    await tx
      .insert(membership)
      .values({
        userId: input.userId,
        organizationId: invite.organizationId,
        role: invite.role,
      })
      .onConflictDoNothing({
        target: [membership.userId, membership.organizationId],
      })
    const [member] = await tx
      .select()
      .from(membership)
      .where(
        and(
          eq(membership.userId, input.userId),
          eq(membership.organizationId, invite.organizationId),
        ),
      )
      .limit(1)
    if (!member) throw new NotFoundError(m.server_member_not_found())
    await tx
      .update(invitation)
      .set({ acceptedAt: new Date() })
      .where(eq(invitation.id, invite.id))
    newlyAccepted.invitationId = invite.id
    // The link was delivered to this address, so it counts as verified.
    if (invite.deliveryStatus === 'sent') {
      await tx
        .update(user)
        .set({ emailVerified: true })
        .where(eq(user.id, input.userId))
    }
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
    return { organizationId: invite.organizationId, role: member.role }
  })
  if (newlyAccepted.invitationId) {
    await notifyInviteAccepted(newlyAccepted.invitationId, input.userId)
  }
  return result
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
    await lockAgencyAdminRoster(tx)
    const [existing] = await tx
      .select({
        id: user.id,
        isAgencyAdmin: user.isAgencyAdmin,
        blockedAt: user.blockedAt,
      })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1)
    if (!existing) {
      throw new NotFoundError(m.server_user_not_found())
    }

    // A blocked admin is not active, so demoting them takes nothing away.
    if (existing.isAgencyAdmin && !isAgencyAdmin && !existing.blockedAt) {
      assertAgencyAdminCanBeRemoved(await countActiveAgencyAdmins(tx))
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
      // A security notice, so it is sent whatever the person's preferences.
      const [actor] = await tx
        .select({ name: user.name })
        .from(user)
        .where(eq(user.id, actorId))
        .limit(1)
      const at = new Date().toISOString()
      await sendAccountEmail({
        kind: isAgencyAdmin ? 'agency_admin_granted' : 'agency_admin_revoked',
        userId,
        params: { userId, at, actorName: actor?.name ?? '' },
        connection: tx,
      })
    }

    return updated
  })
}

export async function listUsers() {
  const blocker = alias(user, 'blocker')
  const lastActive = lastActiveSubquery()
  const users = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      isAgencyAdmin: user.isAgencyAdmin,
      createdAt: user.createdAt,
      twoFactorEnabled: user.twoFactorEnabled,
      blockedAt: user.blockedAt,
      blockedReason: user.blockedReason,
      blockedByName: blocker.name,
      lastActiveAt: lastActive.at,
    })
    .from(user)
    .leftJoin(blocker, eq(user.blockedById, blocker.id))
    .leftJoin(lastActive, eq(lastActive.userId, user.id))
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

  const failureRows = await db
    .select()
    .from(verification)
    .where(
      and(
        like(verification.identifier, 'step-up-failures:%'),
        gt(verification.expiresAt, new Date()),
      ),
    )
  const lockouts = new Map(
    failureRows
      .filter((row) => Number(row.value) >= 5)
      .map((row) => [
        row.identifier.slice('step-up-failures:'.length),
        row.expiresAt,
      ]),
  )

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
    status: row.blockedAt ? ('blocked' as const) : ('active' as const),
    memberships: membershipsByUser.get(row.id) ?? [],
    factorLockedUntil: lockouts.get(row.id) ?? null,
  }))
}

/**
 * Invitations nobody has accepted yet, across every client. Expired ones stay
 * listed (with their expiry) so an agency admin can resend or revoke them.
 */
export async function listPendingInvitations() {
  return db
    .select({
      ...INVITATION_COLUMNS,
      organizationName: organization.name,
    })
    .from(invitation)
    .innerJoin(organization, eq(invitation.organizationId, organization.id))
    .where(isNull(invitation.acceptedAt))
    .orderBy(invitation.email)
}
