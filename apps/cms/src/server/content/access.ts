import { and, eq } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'

import { db } from '#/db'
import { collection, entry, membership, site, user } from '#/db/schema'
import {
  assertMembershipRole,
  requireUser,
  resolveOrgMembership,
} from '#/lib/session.server'
import { m } from '#/paraglide/messages'
import { assertSiteVisibleTo } from '#/server/security/site-visibility'

import { NotFoundError } from './errors.ts'
import { getGlobalEntry } from './globals.ts'

/**
 * Who may read or edit a site, entry or section. Shared by the server
 * functions (`server/fn/content.ts`) and the HTTP routes, so both give the
 * same answer. Plain helpers only: this module is not a server-function module.
 *
 * Each guard reads its object and the caller's membership of the owning
 * organization in one query (membership is a LEFT JOIN on the caller's id),
 * then decides in memory in the same order as before: missing or hidden
 * object, membership (agency admins need two-factor instead), dev-site
 * visibility, role.
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
  const session = await requireUser()
  const row = (
    await db
      .select({ site, memberRole: membership.role })
      .from(site)
      .leftJoin(
        membership,
        and(
          eq(membership.organizationId, site.organizationId),
          eq(membership.userId, session.user.id),
        ),
      )
      .where(eq(site.id, siteId))
      .limit(1)
  ).at(0)
  const notFound = () => new NotFoundError(notFoundMessage())
  if (!row) throw notFound()
  return decideSiteAccess(session, row.site, row.memberRole, role, notFound)
}

async function decideSiteAccess(
  session: Awaited<ReturnType<typeof requireUser>>,
  found: typeof site.$inferSelect,
  memberRole: (typeof membership.$inferSelect)['role'] | null,
  role: 'owner' | undefined,
  notFound: () => Error,
) {
  const access = await resolveOrgMembership(
    session,
    memberRole ? { role: memberRole } : null,
    notFound,
  )
  // Before the role check: a dev env is NotFound for an editor as for an owner.
  await assertSiteVisibleTo(access.session, found, notFound)
  assertMembershipRole(access, role)
  return { session: access.session, site: found, member: access.member }
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

const createdByUser = alias(user, 'created_by_user')
const updatedByUser = alias(user, 'updated_by_user')

/**
 * The entry with its collection, site, the caller's membership and the
 * display names of its creator and last editor, in one read.
 */
export async function requireEntryAccess(entryId: string, role?: 'owner') {
  const session = await requireUser()
  const row = (
    await db
      .select({
        entry,
        collection,
        site,
        memberRole: membership.role,
        createdByName: createdByUser.name,
        createdByEmail: createdByUser.email,
        updatedByName: updatedByUser.name,
        updatedByEmail: updatedByUser.email,
      })
      .from(entry)
      .innerJoin(collection, eq(entry.collectionId, collection.id))
      .innerJoin(site, eq(entry.siteId, site.id))
      .leftJoin(
        membership,
        and(
          eq(membership.organizationId, site.organizationId),
          eq(membership.userId, session.user.id),
        ),
      )
      .leftJoin(createdByUser, eq(entry.createdBy, createdByUser.id))
      .leftJoin(updatedByUser, eq(entry.updatedBy, updatedByUser.id))
      .where(eq(entry.id, entryId))
      .limit(1)
  ).at(0)
  const notFound = () => new NotFoundError(m.server_entry_not_found())
  if (!row) throw notFound()
  // A disabled section is NotFound by id too, before the role check, so an
  // editor gets the same answer as an owner. Same rule as requireGlobalAccess.
  // Agency admins see disabled sections.
  const hiddenSection =
    row.collection.kind === 'global' && !row.collection.enabled
  if (hiddenSection && !session.user.isAgencyAdmin) throw notFound()
  const access = await decideSiteAccess(
    session,
    row.site,
    row.memberRole,
    role,
    notFound,
  )
  return {
    ...access,
    entry: { ...row.entry, collectionKey: row.collection.key },
    collection: row.collection,
    createdByName: row.entry.createdBy
      ? row.createdByName || row.createdByEmail || null
      : null,
    updatedByName: row.entry.updatedBy
      ? row.updatedByName || row.updatedByEmail || null
      : null,
  }
}
