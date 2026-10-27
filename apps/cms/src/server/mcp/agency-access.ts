import { asc, eq } from 'drizzle-orm'

import { db } from '#/db'
import { organization, site } from '#/db/schema'

import { McpNotFoundError } from './errors'
import type { AgencyAccessUser } from './keys'

/**
 * Which sites the agency connector reaches (docs/design/agency-mcp.md, Access
 * groundwork). Every agency path goes through this file: tool calls resolve
 * their site with `resolveAgencySite`, navigation lists with
 * `agencyReachableSites`. v1 reaches every site for an active agency admin, so
 * a later per-admin allow-list changes only this file.
 */

/** A site row with its client (the organization that owns it). */
export type AgencySite = typeof site.$inferSelect & {
  clientName: string
  clientSlug: string
}

/** Every site the user may reach through the agency connector, client by client. */
export async function agencyReachableSites(
  connection: Pick<typeof db, 'select'> = db,
  user: AgencyAccessUser,
): Promise<AgencySite[]> {
  if (!user.isAgencyAdmin || user.blockedAt) return []
  const rows = await connection
    .select({
      site,
      clientName: organization.name,
      clientSlug: organization.slug,
    })
    .from(site)
    .innerJoin(organization, eq(organization.id, site.organizationId))
    .orderBy(asc(organization.name), asc(site.name))
  return rows.map((row) => ({
    ...row.site,
    clientName: row.clientName,
    clientSlug: row.clientSlug,
  }))
}

/**
 * Throws the not-found answer unless the user may reach the site. It answers
 * the same way for a site that does not exist, so the caller learns nothing
 * about sites it cannot reach.
 */
export async function assertAgencySiteReachable(
  user: AgencyAccessUser,
  target: { id: string; slug: string },
): Promise<void> {
  const reachable = await agencyReachableSites(db, user)
  if (!reachable.some((row) => row.id === target.id)) {
    throw notFound(target.slug)
  }
}

/** Resolves a site slug for an agency tool call. Only reachable sites resolve. */
export async function resolveAgencySite(
  user: AgencyAccessUser,
  slug: string,
): Promise<AgencySite> {
  const row = (
    await db
      .select({
        site,
        clientName: organization.name,
        clientSlug: organization.slug,
      })
      .from(site)
      .innerJoin(organization, eq(organization.id, site.organizationId))
      .where(eq(site.slug, slug))
      .limit(1)
  ).at(0)
  if (!row) throw notFound(slug)
  const found = {
    ...row.site,
    clientName: row.clientName,
    clientSlug: row.clientSlug,
  }
  await assertAgencySiteReachable(user, found)
  return found
}

function notFound(slug: string): McpNotFoundError {
  return new McpNotFoundError(
    `No site with slug "${slug}" is available to you. Call list_sites or find_site to find the right slug.`,
  )
}
