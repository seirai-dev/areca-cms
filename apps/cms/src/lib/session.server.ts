import { redirect } from '@tanstack/react-router'
import { getRequestHeaders } from '@tanstack/react-start/server'
import { and, eq } from 'drizzle-orm'

import { db } from '#/db'
import { membership } from '#/db/schema'
import { env } from '#/env'
import { MfaRequiredError } from '#/lib/security-errors'
import {
  SESSION_MEMO_KEY,
  forgetForRequest,
  isReadOnlyRequest,
  memoizeForRequest,
} from '#/server/http/request-scope.server'
import {
  requireAdminLocalMfa,
  requireMemberLocalMfa,
} from '#/server/security/local-mfa'
import { assertFreshSession } from '#/server/security/step-up'

import type { MembershipRole } from './types.ts'
import { auth } from './auth.ts'

const roleRank: Record<MembershipRole, number> = {
  editor: 1,
  owner: 2,
}

/**
 * The session for these request headers. Loaded at most once per request: the
 * guards of one request ask for it several times, and each load is a Better
 * Auth lookup plus database reads (plus the cookie cache (`SESSION_COOKIE_CACHE_SECONDS`) when it has expired).
 */
export function loadSession(headers: Headers) {
  return memoizeForRequest(SESSION_MEMO_KEY, () =>
    auth.api.getSession({
      headers,
      // The cookie cache (`SESSION_COOKIE_CACHE_SECONDS`) serves reads only.
      // A write always checks the database, so a revoked session or a blocked
      // person can never change anything, even while their cookie is cached.
      query: isReadOnlyRequest() ? undefined : { disableCookieCache: true },
    }),
  )
}

export function getSession() {
  return loadSession(getRequestHeaders())
}

/**
 * Call after anything that changes which session this request would see
 * (a session ended, a sign-out). The next `getSession` reads fresh.
 */
export function forgetSession() {
  forgetForRequest(SESSION_MEMO_KEY)
}

/**
 * The signed-in session before the second-factor rule. Only for the steps
 * that lead to passing it, such as entering the code. A blocked person is
 * signed out here too. Their sessions are deleted when they are blocked, so
 * this is defence in depth.
 */
export async function requireSignedIn() {
  const session = await getSession()
  if (!session || session.user.blockedAt) {
    throw redirect({ href: '/login' })
  }
  return session
}

/**
 * A signed-in user whose session counts. Someone with two-factor on must have
 * entered a code in this session (`requireMemberLocalMfa`). Agency admins are
 * held to their own rule by the admin and membership guards below.
 */
export async function requireUser() {
  const session = await requireSignedIn()
  await requireMemberLocalMfa(session)
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
 * Any signed-in user. Agency admins also need two-factor and a local factor
 * proof in this session, the same bar the account routes set in their guards.
 */
export async function requireAccountUser() {
  const session = await requireUser()
  if (session.user.isAgencyAdmin) {
    assertAdminMfa(session.user)
    await requireAdminLocalMfa(session)
  }
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

/** True when a member holding `actual` may do what needs `required`. */
export function hasRole(actual: MembershipRole, required: MembershipRole) {
  return roleRank[actual] >= roleRank[required]
}

export type OrgMembership = {
  session: Awaited<ReturnType<typeof requireUser>>
  /** Null for an agency admin, who is not a member and holds every role. */
  member: { role: MembershipRole } | null
}

const forbidden = () => new Response('Forbidden', { status: 403 })

/** Signed-in user and their membership of the organization, with no role check. */
async function loadOrgMembership(orgId: string): Promise<OrgMembership> {
  const session = await requireUser()
  if (session.user.isAgencyAdmin) {
    return resolveOrgMembership(session, null, forbidden)
  }

  const rows = await db
    .select({ role: membership.role })
    .from(membership)
    .where(
      and(
        eq(membership.userId, session.user.id),
        eq(membership.organizationId, orgId),
      ),
    )
    .limit(1)
  return resolveOrgMembership(session, rows.at(0) ?? null, forbidden)
}

/**
 * The membership decision for a membership row the caller already read (for
 * example joined into the site or entry lookup, see `access.ts`). Agency
 * admins need two-factor and a local factor proof and hold every role; anyone
 * else needs the row, otherwise `notFound()` is thrown.
 */
export async function resolveOrgMembership(
  session: Awaited<ReturnType<typeof requireUser>>,
  member: { role: MembershipRole } | null | undefined,
  notFound: () => unknown,
): Promise<OrgMembership> {
  if (session.user.isAgencyAdmin) {
    assertAdminMfa(session.user)
    await requireAdminLocalMfa(session)
    return { session, member: null }
  }
  if (!member) throw notFound()
  return { session, member: { role: member.role } }
}

/** The 403 for a member whose role is below the one required. */
export function assertMembershipRole(
  found: OrgMembership,
  role: MembershipRole | undefined,
) {
  if (role && found.member && !hasRole(found.member.role, role)) {
    throw new Response('Forbidden', { status: 403 })
  }
}

export async function requireOrgMember(orgId: string, role?: MembershipRole) {
  const found = await loadOrgMembership(orgId)
  assertMembershipRole(found, role)
  return found.session
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
  const found = await loadOrgMembershipOrNotFound(orgId, notFound)
  assertMembershipRole(found, role)
  return found.session
}

/**
 * Membership without a role check, for callers that need the membership row
 * and then decide about the role themselves (see `requireSiteAccess`). A
 * non-member gets `notFound()`.
 */
export async function loadOrgMembershipOrNotFound(
  orgId: string,
  notFound: () => Error,
): Promise<OrgMembership> {
  try {
    return await loadOrgMembership(orgId)
  } catch (error) {
    if (error instanceof Response && error.status === 403) throw notFound()
    throw error
  }
}
