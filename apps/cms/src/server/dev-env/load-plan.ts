import { and, eq, sql } from 'drizzle-orm'

import { db } from '#/db'
import { collection, entry, site } from '#/db/schema'
import { m } from '#/paraglide/messages'
import { NotFoundError } from '#/server/content/errors'
import { fieldKeyUsage } from '#/server/content/field-data'
import { isDevSite } from '#/server/security/site-visibility'

import { buildPlan, productionChangeCount } from './plan'
import type { Plan, PlanInput } from './plan'
import { schemaSnapshot } from './schema-snapshot'

type Reader = Pick<typeof db, 'select' | 'execute'>

export type PlanContext = {
  devSiteId: string
  productionSiteId: string
  organizationId: string
  planInput: PlanInput
}

/**
 * Reads everything the push plan needs for one dev env, through `connection`
 * (the database, or the push transaction, which holds the locks).
 */
export async function loadPlanContext(
  connection: Reader,
  devSiteId: string,
): Promise<PlanContext> {
  const devRow = (
    await connection.select().from(site).where(eq(site.id, devSiteId)).limit(1)
  ).at(0)
  if (!devRow || !isDevSite(devRow) || !devRow.parentSiteId) {
    throw new NotFoundError(m.server_site_not_found())
  }
  const prodRow = (
    await connection
      .select()
      .from(site)
      .where(eq(site.id, devRow.parentSiteId))
      .limit(1)
  ).at(0)
  if (!prodRow) throw new NotFoundError(m.server_site_not_found())

  const devSchema = await schemaSnapshot(connection, devRow.id)
  const productionSchema = await schemaSnapshot(connection, prodRow.id)

  const devEntryRows = await connection
    .select({
      entry,
      collectionKey: collection.key,
      collectionKind: collection.kind,
    })
    .from(entry)
    .innerJoin(collection, eq(entry.collectionId, collection.id))
    .where(eq(entry.siteId, devRow.id))

  const productionEntryRows = await connection
    .select({
      id: entry.id,
      slug: entry.slug,
      status: entry.status,
      contentVersion: entry.contentVersion,
      scheduledAt: entry.scheduledAt,
      collectionKey: collection.key,
      collectionKind: collection.kind,
    })
    .from(entry)
    .innerJoin(collection, eq(entry.collectionId, collection.id))
    .where(eq(entry.siteId, prodRow.id))

  const productionCollections = await connection
    .select({ id: collection.id, key: collection.key })
    .from(collection)
    .where(eq(collection.siteId, prodRow.id))
  const productionFieldUsage: Record<string, Record<string, number>> = {}
  for (const col of productionCollections) {
    productionFieldUsage[col.key] = await fieldKeyUsage(connection, col.id)
  }

  // Entries a main-language switch would stamp: those with no `$locale` yet.
  const stamped = await connection
    .select({ count: sql<number>`count(*)::int` })
    .from(entry)
    .where(
      and(
        eq(entry.siteId, prodRow.id),
        sql`${entry.draftData} -> '$locale' IS NULL`,
      ),
    )

  return {
    devSiteId: devRow.id,
    productionSiteId: prodRow.id,
    organizationId: devRow.organizationId,
    planInput: {
      base: devRow.schemaBaseline,
      dev: devSchema,
      production: productionSchema,
      devEntries: devEntryRows.map(
        ({ entry: row, collectionKey, collectionKind }) => ({
          id: row.id,
          collectionKey,
          collectionKind,
          slug: row.slug,
          status: row.status,
          draftData: row.draftData,
          publishedSlug: row.publishedSlug,
          publishedData: row.publishedData,
          originEntryId: row.originEntryId,
          originBaseline: row.originBaseline,
          originContentVersion: row.originContentVersion,
        }),
      ),
      productionEntries: productionEntryRows.map((row) => ({
        id: row.id,
        collectionKey: row.collectionKey,
        collectionKind: row.collectionKind,
        slug: row.slug,
        contentVersion: row.contentVersion,
        status: row.status,
        scheduled: row.scheduledAt != null,
      })),
      productionFieldUsage,
      stampCount: stamped.at(0)?.count ?? 0,
    },
  }
}

/** The push plan of a dev env, computed from the database now. */
export async function loadPlan(
  connection: Reader,
  devSiteId: string,
): Promise<Plan> {
  const context = await loadPlanContext(connection, devSiteId)
  return buildPlan(context.planInput)
}

/** Items the next push would list: everything changed in dev since the fork or last push. */
export async function countUnpushedChanges(devSiteId: string): Promise<number> {
  return (await loadPlan(db, devSiteId)).items.length
}

/** Production changes since the baseline, regardless of what dev holds. */
export async function countProductionChanges(
  devSiteId: string,
): Promise<number> {
  const context = await loadPlanContext(db, devSiteId)
  return productionChangeCount(context.planInput)
}

/** Both counts from one read, for the dev banner and the status. */
export async function getDevSiteSyncStatus(devSiteId: string) {
  const context = await loadPlanContext(db, devSiteId)
  return {
    unpushedChanges: buildPlan(context.planInput).items.length,
    productionChanges: productionChangeCount(context.planInput),
  }
}
