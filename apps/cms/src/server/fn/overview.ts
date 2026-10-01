import { createServerFn } from '@tanstack/react-start'
import { and, desc, eq, gt, inArray, max, or, sql } from 'drizzle-orm'

import { db } from '#/db'
import {
  collection,
  entry,
  membership,
  organization,
  publication,
  site,
} from '#/db/schema'
import { assertAdminMfa, requireUser } from '#/lib/session.server'

const loose = { strict: { output: false } as const }

/**
 * Organizations the caller may see: `null` for agency admins (everything),
 * otherwise the ids of the organizations they are a member of. Stays private:
 * an exported helper would drag the database client into the browser bundle.
 */
async function accessibleOrgIds(userId: string, isAgencyAdmin: boolean) {
  if (isAgencyAdmin) return null
  const rows = await db
    .select({ organizationId: membership.organizationId })
    .from(membership)
    .where(eq(membership.userId, userId))
  return rows.map((row) => row.organizationId)
}

/**
 * Per-site figures for the dashboard and the Sites page: collection and entry
 * counts, the newest entry change, and whether a publication is live.
 * Scoped to the organizations the caller belongs to (all for agency admins).
 */
export const getSitesOverviewFn = createServerFn({
  method: 'GET',
  ...loose,
}).handler(async () => {
  const session = await requireUser()
  if (session.user.isAgencyAdmin) assertAdminMfa(session.user)
  const orgIds = await accessibleOrgIds(
    session.user.id,
    Boolean(session.user.isAgencyAdmin),
  )
  if (orgIds && orgIds.length === 0) {
    return {
      sites: [],
      totals: { organizations: 0, sites: 0, collections: 0, entries: 0 },
    }
  }
  const scope = orgIds ? inArray(site.organizationId, orgIds) : undefined

  const sites = await db
    .select({
      id: site.id,
      name: site.name,
      slug: site.slug,
      productionUrl: site.productionUrl,
      organizationId: site.organizationId,
      organizationName: organization.name,
      updatedAt: site.updatedAt,
    })
    .from(site)
    .innerJoin(organization, eq(site.organizationId, organization.id))
    .where(scope)
    .orderBy(site.name)

  const siteIds = sites.map((row) => row.id)
  if (siteIds.length === 0) {
    const organizations = orgIds
      ? orgIds.length
      : Number(
          (
            await db
              .select({ n: sql<number>`cast(count(*) as int)` })
              .from(organization)
          )[0]?.n ?? 0,
        )
    return {
      sites: [],
      totals: { organizations, sites: 0, collections: 0, entries: 0 },
    }
  }

  const collectionCounts = await db
    .select({
      siteId: collection.siteId,
      count: sql<number>`cast(count(*) as int)`,
    })
    .from(collection)
    .where(inArray(collection.siteId, siteIds))
    .groupBy(collection.siteId)

  const entryCounts = await db
    .select({
      siteId: entry.siteId,
      count: sql<number>`cast(count(*) as int)`,
      lastUpdated: max(entry.updatedAt),
    })
    .from(entry)
    .where(inArray(entry.siteId, siteIds))
    .groupBy(entry.siteId)

  const liveRows = await db
    .select({ siteId: publication.siteId, createdAt: publication.createdAt })
    .from(publication)
    .where(
      and(inArray(publication.siteId, siteIds), eq(publication.status, 'live')),
    )
    .orderBy(desc(publication.createdAt))

  // Newest live publication per site; the rows arrive newest first.
  const liveSince = new Map<string, Date>()
  for (const row of liveRows) {
    if (!liveSince.has(row.siteId)) liveSince.set(row.siteId, row.createdAt)
  }

  // Published entries the live snapshot does not include yet, for every site
  // in one grouped query. Sites without a live publication count all of them.
  const withoutLive = siteIds.filter((id) => !liveSince.has(id))
  const pendingScopes = [
    ...(withoutLive.length > 0 ? [inArray(entry.siteId, withoutLive)] : []),
    ...[...liveSince.entries()].map(([siteId, createdAt]) =>
      and(eq(entry.siteId, siteId), gt(entry.updatedAt, createdAt)),
    ),
  ]
  const pendingCounts = await db
    .select({
      siteId: entry.siteId,
      count: sql<number>`cast(count(*) as int)`,
    })
    .from(entry)
    .where(
      and(
        inArray(entry.siteId, siteIds),
        eq(entry.status, 'published'),
        or(...pendingScopes),
      ),
    )
    .groupBy(entry.siteId)

  const byCollection = new Map(collectionCounts.map((r) => [r.siteId, r]))
  const byEntry = new Map(entryCounts.map((r) => [r.siteId, r]))
  const byPending = new Map(pendingCounts.map((r) => [r.siteId, r.count]))
  const live = new Set(liveSince.keys())

  const organizations = orgIds
    ? orgIds.length
    : Number(
        (
          await db
            .select({ n: sql<number>`cast(count(*) as int)` })
            .from(organization)
        )[0]?.n ?? 0,
      )

  const rows = sites.map((row) => ({
    ...row,
    collections: byCollection.get(row.id)?.count ?? 0,
    entries: byEntry.get(row.id)?.count ?? 0,
    lastUpdated: byEntry.get(row.id)?.lastUpdated ?? row.updatedAt,
    live: live.has(row.id),
    liveSince: liveSince.get(row.id) ?? null,
    pendingEntries: byPending.get(row.id) ?? 0,
  }))

  return {
    sites: rows,
    totals: {
      organizations,
      sites: rows.length,
      collections: rows.reduce((sum, row) => sum + row.collections, 0),
      entries: rows.reduce((sum, row) => sum + row.entries, 0),
    },
  }
})
