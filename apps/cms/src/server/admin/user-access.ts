/* eslint-disable @typescript-eslint/no-unnecessary-condition -- Drizzle row arrays can be empty at runtime, so lookups stay defensive. */
/**
 * A person's client access: the detail page's read, and the staged batch that
 * adds, changes and removes memberships in one transaction. Role changes and
 * removals reuse the member functions, so last-owner protection and their
 * emails stay in one place.
 */
import { and, count, desc, eq, gt, isNull } from 'drizzle-orm'

import { db } from '#/db'
import type { Tx } from '#/db'
import {
  account,
  invitation,
  membership,
  organization,
  session,
  user,
} from '#/db/schema'
import { m } from '#/paraglide/messages'
import { audit } from '#/server/audit'
import { ConflictError, NotFoundError } from '#/server/content/errors'
import { lastActiveSubquery } from './last-active'
import { sendAccountEmail } from '#/server/mail/account-emails'
import type { MembershipRole } from '#/lib/types'

import {
  applyMemberRemoval,
  applyMemberRole,
  lockOrganization,
} from './members'
import { lockPerson, runBulk } from './users'
import type { BulkResult } from './users'

export type AccessGrant = { organizationId: string; role: MembershipRole }

export type ClientAccessChange = {
  /** Clients the person is not in yet. */
  add: AccessGrant[]
  /** Clients the person is in, with a new role. */
  change: AccessGrant[]
  /** Clients the person leaves. */
  remove: string[]
}

export type ClientAccessResult = {
  added: number
  changed: number
  removed: number
}

/** The person's page: profile, sign-in state and client access. */
export async function getUserDetail(userId: string) {
  const [person] = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      isAgencyAdmin: user.isAgencyAdmin,
      twoFactorEnabled: user.twoFactorEnabled,
      createdAt: user.createdAt,
      blockedAt: user.blockedAt,
      blockedReason: user.blockedReason,
      blockedById: user.blockedById,
    })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1)
  if (!person) throw new NotFoundError(m.server_user_not_found())

  const [blocker] = person.blockedById
    ? await db
        .select({ name: user.name })
        .from(user)
        .where(eq(user.id, person.blockedById))
        .limit(1)
    : [undefined]

  const [credential] = await db
    .select({ id: account.id })
    .from(account)
    .where(
      and(eq(account.userId, userId), eq(account.providerId, 'credential')),
    )
    .limit(1)

  const [activeSessions] = await db
    .select({ value: count() })
    .from(session)
    .where(and(eq(session.userId, userId), gt(session.expiresAt, new Date())))
  // The same definition as the people list (see last-active.ts).
  const lastActive = lastActiveSubquery()
  const [lastActiveRow] = await db
    .select({ at: lastActive.at })
    .from(lastActive)
    .where(eq(lastActive.userId, userId))
  const lastActiveAt = lastActiveRow?.at ?? null

  const memberRows = await db
    .select({
      organizationId: membership.organizationId,
      organizationName: organization.name,
      organizationSlug: organization.slug,
      role: membership.role,
      joinedAt: membership.createdAt,
    })
    .from(membership)
    .innerJoin(organization, eq(membership.organizationId, organization.id))
    .where(eq(membership.userId, userId))
    .orderBy(organization.name)
  const memberships = []
  for (const row of memberRows) {
    const [owners] = await db
      .select({ value: count() })
      .from(membership)
      .where(
        and(
          eq(membership.organizationId, row.organizationId),
          eq(membership.role, 'owner'),
        ),
      )
    memberships.push({
      ...row,
      isOnlyOwner: row.role === 'owner' && Number(owners?.value ?? 0) <= 1,
    })
  }

  const pendingInvitations = await db
    .select({
      id: invitation.id,
      organizationId: invitation.organizationId,
      organizationName: organization.name,
      role: invitation.role,
      expiresAt: invitation.expiresAt,
      createdAt: invitation.createdAt,
    })
    .from(invitation)
    .innerJoin(organization, eq(invitation.organizationId, organization.id))
    .where(
      and(
        eq(invitation.email, person.email.toLowerCase()),
        isNull(invitation.acceptedAt),
      ),
    )
    .orderBy(desc(invitation.createdAt))

  return {
    id: person.id,
    name: person.name,
    email: person.email,
    isAgencyAdmin: person.isAgencyAdmin,
    twoFactorEnabled: person.twoFactorEnabled,
    createdAt: person.createdAt,
    blocked: person.blockedAt
      ? {
          at: person.blockedAt,
          reason: person.blockedReason,
          byName: blocker?.name ?? null,
        }
      : null,
    hasPassword: Boolean(credential),
    activeSessions: activeSessions?.value ?? 0,
    lastActiveAt,
    memberships,
    pendingInvitations,
  }
}

export type UserDetail = Awaited<ReturnType<typeof getUserDetail>>

/** Raw `max(timestamptz)` values come back as text, so read them as dates. */
export function toDate(value: unknown): Date | null {
  return value ? new Date(String(value)) : null
}

/**
 * Applies the staged changes in one transaction. Clients are visited in id
 * order, so two batches over overlapping clients lock them in the same order.
 * One `membership_added` email lists every client added.
 */
export async function setUserClientAccess(
  input: ClientAccessChange & { actorId: string; userId: string },
): Promise<ClientAccessResult> {
  const touched = [
    ...input.add.map((grant) => grant.organizationId),
    ...input.change.map((grant) => grant.organizationId),
    ...input.remove,
  ]
  if (new Set(touched).size !== touched.length) {
    throw new ConflictError(m.server_access_conflicting_changes())
  }

  type Step =
    | { kind: 'add'; organizationId: string; role: MembershipRole }
    | { kind: 'change'; organizationId: string; role: MembershipRole }
    | { kind: 'remove'; organizationId: string }
  const steps: Step[] = [
    ...input.add.map((g) => ({ kind: 'add' as const, ...g })),
    ...input.change.map((g) => ({ kind: 'change' as const, ...g })),
    ...input.remove.map((organizationId) => ({
      kind: 'remove' as const,
      organizationId,
    })),
  ].sort((a, b) => a.organizationId.localeCompare(b.organizationId))

  return db.transaction(async (tx) => {
    const person = await lockPerson(tx, input.userId)
    const added: Array<{ name: string; role: MembershipRole }> = []
    const result: ClientAccessResult = { added: 0, changed: 0, removed: 0 }

    for (const step of steps) {
      if (step.kind === 'add') {
        const name = await addMembership(tx, {
          organizationId: step.organizationId,
          userId: person.id,
          userName: person.name,
          email: person.email,
          role: step.role,
          actorId: input.actorId,
        })
        added.push({ name, role: step.role })
        result.added += 1
      } else if (step.kind === 'change') {
        const updated = await applyMemberRole(tx, {
          organizationId: step.organizationId,
          userId: person.id,
          role: step.role,
          actorId: input.actorId,
        })
        if (updated) result.changed += 1
      } else {
        await applyMemberRemoval(tx, {
          organizationId: step.organizationId,
          userId: person.id,
          actorId: input.actorId,
        })
        result.removed += 1
      }
    }

    // Changing your own access needs no email. The list reads by client name.
    if (added.length > 0 && input.actorId !== person.id) {
      added.sort((a, b) => a.name.localeCompare(b.name))
      await sendAccountEmail({
        kind: 'membership_added',
        userId: person.id,
        params: {
          userId: person.id,
          actorName: await nameOf(tx, input.actorId),
          orgs: added,
        },
        connection: tx,
      })
    }
    return result
  })
}

async function nameOf(tx: Tx, userId: string) {
  const [row] = await tx
    .select({ name: user.name })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1)
  return row?.name ?? ''
}

/** Adds a direct membership (no invitation). Returns the client's name. */
async function addMembership(
  tx: Tx,
  input: {
    organizationId: string
    userId: string
    userName: string
    email: string
    role: MembershipRole
    actorId: string
  },
) {
  await lockOrganization(tx, input.organizationId)
  const [org] = await tx
    .select({ id: organization.id, name: organization.name })
    .from(organization)
    .where(eq(organization.id, input.organizationId))
    .limit(1)
  if (!org) throw new NotFoundError(m.server_organization_not_found())

  const [existing] = await tx
    .select({ id: membership.id })
    .from(membership)
    .where(
      and(
        eq(membership.userId, input.userId),
        eq(membership.organizationId, input.organizationId),
      ),
    )
    .limit(1)
  if (existing) {
    throw new ConflictError(m.server_access_already_member({ org: org.name }))
  }

  const [row] = await tx
    .insert(membership)
    .values({
      userId: input.userId,
      organizationId: input.organizationId,
      role: input.role,
    })
    .returning({ id: membership.id })
  if (!row) throw new Error(m.server_member_not_found())

  await audit(
    {
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: 'member.add',
      targetType: 'membership',
      targetId: row.id,
      meta: {
        userId: input.userId,
        userName: input.userName,
        email: input.email,
        role: input.role,
        direct: true,
      },
    },
    tx,
  )
  return org.name
}

/**
 * Adds several people to the same clients with one role. People already in
 * every chosen client are skipped; the rest get exactly the clients they lack.
 */
export async function bulkAddUsersToClients(input: {
  actorId: string
  userIds: string[]
  organizationIds: string[]
  role: MembershipRole
}): Promise<BulkResult> {
  return runBulk(input.actorId, input.userIds, async (userId) => {
    const existing = await db
      .select({ organizationId: membership.organizationId })
      .from(membership)
      .where(eq(membership.userId, userId))
    const have = new Set(existing.map((row) => row.organizationId))
    const missing = input.organizationIds.filter((id) => !have.has(id))
    if (missing.length === 0) return 'already_member'
    await setUserClientAccess({
      actorId: input.actorId,
      userId,
      add: missing.map((organizationId) => ({
        organizationId,
        role: input.role,
      })),
      change: [],
      remove: [],
    })
    return null
  })
}
