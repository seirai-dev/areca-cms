import { and, eq, sql } from 'drizzle-orm'

import { db } from '#/db'
import type { DbExecutor } from '#/db'
import { collection, entry, site } from '#/db/schema'
import { entryTitle } from '#/lib/content/utils'
import type { EntryData, SchemaSnapshotItem } from '#/lib/types'
import { m } from '#/paraglide/messages'
import { NotFoundError } from '#/server/content/errors'
import { fieldKeyUsage } from '#/server/content/field-data'
import { isDevSite } from '#/server/security/site-visibility'

import {
  buildPlan,
  collectionsMatchProduction,
  productionChangeCount,
} from './plan'
import type { Plan, PlanInput } from './plan'
import { schemaSnapshot } from './schema-snapshot'

/**
 * Row title of a dev entry: a section shows its label, an entry its main-language
 * title (the same one the collection list shows), or its slug when it has none.
 */
function planEntryTitle(
  row: { slug: string; draftData: EntryData; collectionKind: string },
  def: SchemaSnapshotItem | undefined,
): string {
  if (row.collectionKind === 'global') return def?.label ?? row.slug
  return entryTitle(row.draftData, def?.fields ?? [], row.slug)
}

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
  connection: DbExecutor,
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
      draftData: entry.draftData,
      publishedData: entry.publishedData,
      scheduledData: entry.scheduledData,
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
          title: planEntryTitle(
            { slug: row.slug, draftData: row.draftData, collectionKind },
            devSchema.collections.find((def) => def.key === collectionKey),
          ),
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
        title: planEntryTitle(
          {
            slug: row.slug,
            draftData: row.draftData,
            collectionKind: row.collectionKind,
          },
          productionSchema.collections.find(
            (def) => def.key === row.collectionKey,
          ),
        ),
        draftData: row.draftData,
        publishedData: row.publishedData,
        scheduledData: row.scheduledData,
      })),
      productionFieldUsage,
      stampCount: stamped.at(0)?.count ?? 0,
    },
  }
}

/** The push plan of a dev env, computed from the database now. */
export async function loadPlan(
  connection: DbExecutor,
  devSiteId: string,
): Promise<Plan> {
  const context = await loadPlanContext(connection, devSiteId)
  return buildPlan(context.planInput)
}

/** Items the next push would list: everything changed in dev since the fork or last push. */
export async function countUnpushedChanges(devSiteId: string): Promise<number> {
  return (await loadPlan(db, devSiteId)).items.length
}

/** Both counts from one read, for the dev banner and the status. */
export async function getDevSiteSyncStatus(devSiteId: string) {
  const context = await loadPlanContext(db, devSiteId)
  return {
    unpushedChanges: buildPlan(context.planInput).items.length,
    productionChanges: productionChangeCount(context.planInput),
    /** Per collection or section: does it match production (copy to production needs it)? */
    schemaMatches: collectionsMatchProduction(context.planInput),
  }
}
