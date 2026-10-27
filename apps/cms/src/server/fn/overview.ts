import { createServerFn } from '@tanstack/react-start'
import { and, desc, eq, inArray, max, sql } from 'drizzle-orm'

import { db } from '#/db'
import {
  collection,
  entry,
  membership,
  organization,
  publication,
  site,
} from '#/db/schema'
import { requireUser } from '#/lib/session.server'
import { NotFoundError } from '#/server/content/errors'
import { requireAdminLocalMfa } from '#/server/security/local-mfa'
import { diffApprovedRelease } from '#/server/publishing/release-diff'

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
  if (session.user.isAgencyAdmin) await requireAdminLocalMfa(session)
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
  // Dev envs are not separate sites here: they are listed under their
  // production site (docs/design/dev-environments.md, Decision 3).
  const scope = and(
    orgIds ? inArray(site.organizationId, orgIds) : undefined,
    eq(site.environment, 'production'),
  )

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
    .where(
      and(
        inArray(collection.siteId, siteIds),
        eq(collection.kind, 'collection'),
      ),
    )
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

  // A site deleted after the list above is simply gone: `null` marks it and it
  // is left out, rather than failing the whole overview.
  const pendingPairs = await Promise.all(
    siteIds.map(async (siteId) => {
      try {
        const diff = await diffApprovedRelease(siteId)
        return [siteId, diff.pendingCount] as const
      } catch (error) {
        if (error instanceof NotFoundError) return [siteId, null] as const
        throw error
      }
    }),
  )

  const byCollection = new Map(collectionCounts.map((r) => [r.siteId, r]))
  const byEntry = new Map(entryCounts.map((r) => [r.siteId, r]))
  const byPending = new Map(pendingPairs)
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

  const rows = sites
    .filter((row) => byPending.get(row.id) !== null)
    .map((row) => ({
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
