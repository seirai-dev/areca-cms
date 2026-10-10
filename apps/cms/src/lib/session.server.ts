import { redirect } from '@tanstack/react-router'
import { getRequestHeaders } from '@tanstack/react-start/server'
import { and, eq } from 'drizzle-orm'

import { db } from '#/db'
import { membership } from '#/db/schema'
import { env } from '#/env'
import { MfaRequiredError } from '#/lib/security-errors'
import { requireAdminLocalMfa } from '#/server/security/local-mfa'
import { assertFreshSession } from '#/server/security/step-up'

import type { MembershipRole } from './types.ts'
import { auth } from './auth.ts'

const roleRank: Record<MembershipRole, number> = {
  editor: 1,
  owner: 2,
}

export async function getSession() {
  return auth.api.getSession({
    headers: getRequestHeaders(),
  })
}

export async function requireUser() {
  const session = await getSession()
  if (!session) {
    throw redirect({ href: '/login' })
  }
  return session
}

/**
 * Agency admins can reach every client, so they must have two-factor enabled
 * before any admin power is exercised. Throws `MFA_REQUIRED` otherwise.
 */
export function assertAdminMfa(
  user: { twoFactorEnabled?: boolean | null },
  required: boolean = env.ADMIN_MFA_REQUIRED,
) {
  if (required && !user.twoFactorEnabled) {
    throw new MfaRequiredError()
  }
}

export async function requireAgencyAdmin() {
  const session = await requireUser()
  if (!session.user.isAgencyAdmin) {
    throw new Response('Forbidden', { status: 403 })
  }
  assertAdminMfa(session.user)
  await requireAdminLocalMfa(session)
  return session
}

/**
 * `requireAgencyAdmin` plus the step-up gate (see `assertFreshSession`) for
 * deleting organizations, deployment credentials, site tokens and changing
 * agency-admin status. Throws `REAUTH_REQUIRED` when the session is stale.
 */
export async function requireFreshAgencyAdmin() {
  const session = await requireAgencyAdmin()
  await assertFreshSession(session)
  return session
}

export async function requireOrgMember(orgId: string, role?: MembershipRole) {
  const session = await requireUser()
  if (session.user.isAgencyAdmin) {
    assertAdminMfa(session.user)
    await requireAdminLocalMfa(session)
    return session
  }

  const rows = await db
    .select()
    .from(membership)
    .where(
      and(
        eq(membership.userId, session.user.id),
        eq(membership.organizationId, orgId),
      ),
    )
    .limit(1)
  const member = rows.at(0)

  if (!member) {
    throw new Response('Forbidden', { status: 403 })
  }

  if (role && roleRank[member.role] < roleRank[role]) {
    throw new Response('Forbidden', { status: 403 })
  }

  return session
}

/**
 * `requireOrgMember` for callers that reached an organization through an
 * object id (site, entry, asset, invitation...). A caller who is not a member
 * gets `notFound()`, the same answer as for an id that does not exist, so ids
 * of other tenants cannot be confirmed. Members with too low a role still get
 * the 403: they already know the object exists.
 */
export async function requireOrgMemberOrNotFound(
  orgId: string,
  role: MembershipRole | undefined,
  notFound: () => Error,
) {
  try {
    await requireOrgMember(orgId)
  } catch (error) {
    if (error instanceof Response && error.status === 403) throw notFound()
    throw error
  }
  return requireOrgMember(orgId, role)
}
