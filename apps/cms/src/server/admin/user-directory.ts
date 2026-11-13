/** The agency's people list: every user with their clients and status. */
import { eq } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'

import { db } from '#/db'
import { membership, organization, user } from '#/db/schema'
import type { MembershipRole } from '#/lib/types'
import { activeFactorLockouts } from '#/server/security/step-up'

import { lastActiveSubquery } from './last-active'

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

  const lockouts = await activeFactorLockouts()

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
