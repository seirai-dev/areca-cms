import { eq, inArray } from 'drizzle-orm'
import {
  buildJob,
  collection,
  deletedContentArchive,
  entry,
  entryRevision,
  publication,
  site,
} from '#/db/schema'
import { assetAttachLock } from '#/server/assets/usage'
import type { AssetTransaction } from '#/server/assets/usage'

/** Preserve deleted authoring versions until the organization itself is deleted. */
export async function archiveDeletedContent(
  tx: AssetTransaction,
  organizationId: string,
  entityType: 'entry' | 'collection' | 'site',
  entityId: string,
) {
  await assetAttachLock(tx, organizationId)
  const entries = await tx
    .select()
    .from(entry)
    .where(
      entityType === 'entry'
        ? eq(entry.id, entityId)
        : entityType === 'collection'
          ? eq(entry.collectionId, entityId)
          : eq(entry.siteId, entityId),
    )
  const revisions = entries.length
    ? await tx
        .select()
        .from(entryRevision)
        .where(
          inArray(
            entryRevision.entryId,
            entries.map((row) => row.id),
          ),
        )
    : []
  const collections =
    entityType === 'entry'
      ? []
      : await tx
          .select()
          .from(collection)
          .where(
            entityType === 'collection'
              ? eq(collection.id, entityId)
              : eq(collection.siteId, entityId),
          )
  const publications =
    entityType === 'site'
      ? await tx
          .select()
          .from(publication)
          .where(eq(publication.siteId, entityId))
      : []
  const jobs =
    entityType === 'site'
      ? await tx.select().from(buildJob).where(eq(buildJob.siteId, entityId))
      : []
  const siteRow = (
    entityType === 'site'
      ? await tx
          .select({
            id: site.id,
            name: site.name,
            slug: site.slug,
            productionUrl: site.productionUrl,
            publishingMode: site.publishingMode,
            lastManifest: site.lastManifest,
            createdAt: site.createdAt,
          })
          .from(site)
          .where(eq(site.id, entityId))
      : []
  ).at(0)
  await tx.insert(deletedContentArchive).values({
    organizationId,
    entityType,
    entityId,
    data: {
      entries,
      revisions,
      collections,
      publications,
      jobs,
      ...(siteRow ? { site: siteRow } : {}),
    },
  })
}
