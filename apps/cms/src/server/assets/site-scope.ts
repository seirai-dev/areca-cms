import { and, eq, inArray } from 'drizzle-orm'
import { db } from '#/db'
import {
  asset,
  collection,
  entry,
  entryRevision,
  publication,
} from '#/db/schema'
import { SEO_KEY } from '#/lib/seo'
import type { EntryData, Field, SnapshotGlobal } from '#/lib/types'
import { loadAssetLookup } from './index'
import type { Asset } from './index'
import { richTextAssetRefs } from './richtext-ownership'

/** A site's AI sees its own uploads and media actually referenced by its content. */
export async function siteAssets(
  organizationId: string,
  siteId: string,
): Promise<Asset[]> {
  const [collections, entries, uploads, publications] = await Promise.all([
    db.select().from(collection).where(eq(collection.siteId, siteId)),
    db.select().from(entry).where(eq(entry.siteId, siteId)),
    db
      .select()
      .from(asset)
      .where(
        and(
          eq(asset.organizationId, organizationId),
          eq(asset.originSiteId, siteId),
        ),
      ),
    db
      .select({ snapshot: publication.snapshot })
      .from(publication)
      .where(eq(publication.siteId, siteId)),
  ])
  const ids = new Set<string>()
  const storageKeys = new Set<string>()
  const fieldsByKey = new Map(collections.map((row) => [row.id, row.fields]))
  const collect = (fields: Field[], data: EntryData | null) => {
    if (!data) return
    for (const field of fields) {
      const value = data[field.key]
      if (field.type === 'image' && typeof value === 'string' && value)
        ids.add(value)
      if (field.type === 'richtext') {
        for (const key of richTextAssetRefs(value).storageKeys)
          storageKeys.add(key)
      }
    }
    const seo = data[SEO_KEY] as { ogImage?: unknown } | undefined
    if (typeof seo?.ogImage === 'string' && seo.ogImage) ids.add(seo.ogImage)
  }
  for (const row of entries) {
    const fields = fieldsByKey.get(row.collectionId) ?? []
    collect(fields, row.draftData)
    collect(fields, row.publishedData)
    collect(fields, row.scheduledData)
  }
  if (entries.length) {
    const revisions = await db
      .select()
      .from(entryRevision)
      .where(
        inArray(
          entryRevision.entryId,
          entries.map((row) => row.id),
        ),
      )
    const entryById = new Map(entries.map((row) => [row.id, row]))
    for (const revision of revisions) {
      const owner = entryById.get(revision.entryId)
      if (owner)
        collect(fieldsByKey.get(owner.collectionId) ?? [], revision.data)
    }
  }
  // Frozen publications may outlive their schemas. Only resolved media fields
  // grant access; plain text, reference IDs and JSON-LD strings never do.
  const collectImage = (value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return
    const image = value as { url?: unknown; mimeType?: unknown }
    if (typeof image.url !== 'string' || typeof image.mimeType !== 'string')
      return
    for (const key of richTextAssetRefs({
      type: 'image',
      attrs: { src: image.url },
    }).storageKeys)
      storageKeys.add(key)
  }
  const collectPublished = (row: {
    data: Record<string, unknown>
    seo?: SnapshotGlobal['seo']
  }) => {
    for (const value of Object.values(row.data)) {
      collectImage(value)
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const richText = value as { json?: { type?: unknown } | null }
        if (richText.json?.type === 'doc') {
          for (const key of richTextAssetRefs(richText.json).storageKeys)
            storageKeys.add(key)
        }
      }
    }
    collectImage(row.seo?.openGraph.image)
    collectImage(row.seo?.twitter.image)
  }
  for (const { snapshot } of publications) {
    for (const rows of Object.values(snapshot.collections)) {
      for (const row of rows) collectPublished(row)
    }
    // Site content sections ship with the release too, so their media counts.
    for (const global of Object.values(snapshot.globals ?? {})) {
      collectPublished(global)
    }
  }
  const lookup = await loadAssetLookup(organizationId, {
    ids: [...ids],
    storageKeys: [...storageKeys],
  })
  const visible = new Map<string, Asset>(uploads.map((row) => [row.id, row]))
  for (const row of lookup.byId.values()) visible.set(row.id, row)
  return [...visible.values()].sort(
    (a, b) =>
      b.createdAt.getTime() - a.createdAt.getTime() || a.id.localeCompare(b.id),
  )
}

export async function siteAssetLookup(organizationId: string, siteId: string) {
  const rows = await siteAssets(organizationId, siteId)
  return {
    byId: new Map(rows.map((row) => [row.id, row])),
    byStorageKey: new Map(rows.map((row) => [row.storageKey, row])),
  }
}
