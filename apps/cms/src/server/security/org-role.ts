import { and, eq, inArray } from 'drizzle-orm'

import { db } from '#/db'
import { membership } from '#/db/schema'
import type { MembershipRole } from '#/lib/types'

export type OrgRole = MembershipRole | 'agency'

/** The membership roles of these users in one organization, in one query. */
export async function membershipRoles(
  organizationId: string,
  userIds: string[],
): Promise<Map<string, MembershipRole>> {
  if (userIds.length === 0) return new Map()
  const rows = await db
    .select({ userId: membership.userId, role: membership.role })
    .from(membership)
    .where(
      and(
        eq(membership.organizationId, organizationId),
        inArray(membership.userId, userIds),
      ),
    )
  return new Map(rows.map((row) => [row.userId, row.role]))
}

/** The user's membership role in the organization, or null for a non-member. */
export async function membershipRole(
  userId: string,
  organizationId: string,
): Promise<MembershipRole | null> {
  const [member] = await db
    .select({ role: membership.role })
    .from(membership)
    .where(
      and(
        eq(membership.userId, userId),
        eq(membership.organizationId, organizationId),
      ),
    )
    .limit(1)
  return member?.role ?? null
}

/**
 * The role a user acts with in an organization: 'agency' for an agency admin
 * (member or not), otherwise their membership role, or null for a non-member.
 * Second-factor and blocked checks are the caller's.
 */
export async function orgRoleOf(
  person: { id: string; isAgencyAdmin: boolean },
  organizationId: string,
): Promise<OrgRole | null> {
  if (person.isAgencyAdmin) return 'agency'
  return membershipRole(person.id, organizationId)
}
