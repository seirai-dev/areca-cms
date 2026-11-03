import { eq } from 'drizzle-orm'

import { db } from '#/db'
import { site } from '#/db/schema'
import {
  assertMembershipRole,
  loadOrgMembershipOrNotFound,
  requireUser,
} from '#/lib/session.server'
import { m } from '#/paraglide/messages'
import { assertSiteVisibleTo } from '#/server/security/site-visibility'

import { findEntryAndSection } from './entries.ts'
import { NotFoundError } from './errors.ts'
import { getGlobalEntry } from './globals.ts'

/**
 * Who may read or edit a site, entry or section. Shared by the server
 * functions (`server/fn/content.ts`) and the HTTP routes, so both give the
 * same answer. Plain helpers only: this module is not a server-function module.
 */

export async function requireSiteAccess(
  siteId: string,
  role?: 'owner',
  notFoundMessage: () => ReturnType<
    typeof m.server_site_not_found
  > = m.server_site_not_found,
) {
  // Authenticate before looking anything up, and answer NotFound both for a
  // missing site and for one the caller has no access to, so site ids of
  // other tenants cannot be probed.
  await requireUser()
  const found = (
    await db.select().from(site).where(eq(site.id, siteId)).limit(1)
  ).at(0)
  if (!found) {
    throw new NotFoundError(notFoundMessage())
  }
  // One membership read serves both the visibility and the role check.
  const membership = await loadOrgMembershipOrNotFound(
    found.organizationId,
    () => new NotFoundError(notFoundMessage()),
  )
  // Before the role check: a dev env is NotFound for an editor as for an owner.
  await assertSiteVisibleTo(
    membership.session,
    found,
    () => new NotFoundError(notFoundMessage()),
  )
  assertMembershipRole(membership, role)
  return { session: membership.session, site: found }
}

/**
 * A site content section the caller may use. Disabled sections are hidden
 * from editors and owners; only the agency sees and edits them.
 */
export async function requireGlobalAccess(siteId: string, key: string) {
  const access = await requireSiteAccess(siteId)
  const found = await getGlobalEntry(siteId, key)
  if (!found || (!found.global.enabled && !access.session.user.isAgencyAdmin)) {
    throw new NotFoundError(m.server_not_found())
  }
  return { ...access, ...found }
}

export async function requireEntryAccess(entryId: string, role?: 'owner') {
  const viewer = await requireUser()
  const found = await findEntryAndSection(entryId)
  if (!found) {
    throw new NotFoundError(m.server_entry_not_found())
  }
  // A disabled section is NotFound by id too, before the role check, so an
  // editor gets the same answer as an owner. Same rule as requireGlobalAccess.
  // Agency admins see disabled sections.
  if (found.hiddenSection && !viewer.user.isAgencyAdmin) {
    throw new NotFoundError(m.server_entry_not_found())
  }
  const access = await requireSiteAccess(
    found.entry.siteId,
    role,
    m.server_entry_not_found,
  )
  return { ...access, entry: found.entry }
}
