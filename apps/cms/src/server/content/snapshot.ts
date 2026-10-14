import {
  richTextAssetRefs,
  richTextAssetsAuthorized,
  richTextAssetsAuthorizedFrom,
} from '#/server/assets/richtext-ownership'
import { createHash } from 'node:crypto'
import { and, eq, or } from 'drizzle-orm'

import { db } from '#/db'
import { collection, entry, site } from '#/db/schema'
import {
  GLOBAL_ENTRY_SLUG,
  globalPublicUrl,
  globalsAsEntryLists,
} from '#/lib/globals'
import { entryPublicUrl, readEntrySeo, withoutSeo } from '#/lib/seo'
import type {
  EntryData,
  Field,
  GlobalConfig,
  ImageValue,
  ReferenceValue,
  Snapshot,
  SnapshotEntry,
  SnapshotGlobal,
} from '#/lib/types'
import { m } from '#/paraglide/messages'
import {
  loadAssetLookup,
  resolveAssetFromLookup,
  resolveAssetValue,
} from '#/server/assets'
import type { AssetLookup } from '#/server/assets'
import { snapshotAssets } from '#/server/assets/published-assets'
import { convertRichText, validateRichText } from '#/server/richtext'

import { getCollection, listCollections } from './collections.ts'
import { getGlobalEntry, listGlobals } from './globals.ts'
import { NotFoundError, ValidationError } from './errors.ts'
import { buildEntrySeo } from './seo.ts'
import { buildSnapshotSchema } from './snapshot-schema.ts'
import { pickDeclaredFields, validateEntryData } from './validation.ts'

type IncludedEntry = {
  collectionKey: string
  routePattern: string
  fields: Field[]
  row: typeof entry.$inferSelect
  data: EntryData
  slug: string
  publishedAt: Date | null
}

export type SnapshotOptions = {
  /**
   * Release diff only. A section with required fields that was never marked
   * ready is left out of the candidate instead of failing the build, so the
   * ready changes still list while the site is blocked. Go live keeps the
   * default and refuses.
   */
  allowNeverReadySections?: boolean
}

export async function buildSnapshot(
  siteId: string,
  connection: Pick<typeof db, 'select'> = db,
  options: SnapshotOptions = {},
): Promise<
  | {
      ok: true
      snapshot: Snapshot
      hash: string
      entryVersions: { entryId: string; scheduledVersion: string }[]
    }
  | { ok: false; errors: string[] }
> {
  const [existingSite] = await connection
    .select()
    .from(site)
    .where(eq(site.id, siteId))
    .limit(1)
  if (!existingSite) {
    throw new NotFoundError(m.server_site_not_found())
  }

  const now = new Date()
  const enabled = await listCollections(
    siteId,
    { enabledOnly: true },
    connection,
  )
  const errors: string[] = []
  const entryVersions: { entryId: string; scheduledVersion: string }[] = []
  const included: IncludedEntry[] = []

  for (const col of enabled) {
    const rows = await connection
      .select()
      .from(entry)
      .where(
        and(
          eq(entry.siteId, siteId),
          eq(entry.collectionId, col.id),
          or(eq(entry.status, 'published'), eq(entry.status, 'scheduled')),
        ),
      )

    for (const row of rows) {
      const isScheduledDue =
        row.status === 'scheduled' &&
        row.scheduledAt != null &&
        row.scheduledAt <= now
      const data = isScheduledDue ? row.scheduledData : row.publishedData
      const slug = isScheduledDue ? row.scheduledSlug : row.publishedSlug
      if (!isScheduledDue && row.status === 'scheduled' && !data) continue
      if (!slug) {
        errors.push(`${col.key}/${row.id}: missing approved slug`)
        continue
      }
      if (isScheduledDue && !row.scheduledVersion) {
        errors.push(`${col.key}/${row.id}: missing scheduled version`)
        continue
      }
      if (data == null) {
        errors.push(`${col.key}/${row.slug}: missing published data`)
        continue
      }
      const parsed = validateEntryData(col.fields, data)
      if (!parsed.ok) {
        for (const err of parsed.errors) {
          errors.push(
            `${col.key}/${row.slug}: ${err.path ? `${err.path}: ` : ''}${err.message}`,
          )
        }
        continue
      }
      if (isScheduledDue)
        entryVersions.push({
          entryId: row.id,
          scheduledVersion: row.scheduledVersion!,
        })
      included.push({
        slug,
        collectionKey: col.key,
        routePattern: col.routePattern,
        fields: col.fields,
        row,
        data: parsed.data,
        publishedAt: isScheduledDue ? row.scheduledAt : row.publishedAt,
      })
    }
  }

  // Site content sections: one `$global` entry each. A section with no ready
  // data blocks go live only when it has required fields; otherwise it ships `{}`.
  const sections = await listGlobals(siteId, { enabledOnly: true }, connection)
  const sectionItems = new Map<string, IncludedEntry>()
  const unreadySections = new Map<string, string>()
  for (const section of sections) {
    const [row] = await connection
      .select()
      .from(entry)
      .where(
        and(
          eq(entry.siteId, siteId),
          eq(entry.collectionId, section.id),
          eq(entry.slug, GLOBAL_ENTRY_SLUG),
        ),
      )
      .limit(1)
    if (!row) {
      errors.push(`Site content "${section.label}": entry is missing`)
      continue
    }
    const isScheduledDue =
      row.status === 'scheduled' &&
      row.scheduledAt != null &&
      row.scheduledAt <= now
    const data =
      row.status === 'draft'
        ? null
        : isScheduledDue
          ? row.scheduledData
          : row.publishedData
    if (data == null) {
      if (section.fields.some((field) => field.required)) {
        if (!options.allowNeverReadySections) {
          errors.push(
            `Site content "${section.label}" has required fields and has never been marked ready.`,
          )
        }
      } else {
        unreadySections.set(section.key, row.id)
      }
      continue
    }
    if (isScheduledDue) {
      if (!row.scheduledVersion) {
        errors.push(`${section.key}: missing scheduled version`)
        continue
      }
      entryVersions.push({
        entryId: row.id,
        scheduledVersion: row.scheduledVersion,
      })
    }
    const parsed = validateEntryData(section.fields, data)
    if (!parsed.ok) {
      for (const err of parsed.errors) {
        errors.push(
          `Site content "${section.label}": ${err.path ? `${err.path}: ` : ''}${err.message}`,
        )
      }
      continue
    }
    sectionItems.set(section.key, {
      collectionKey: section.key,
      routePattern: '',
      fields: section.fields,
      row,
      data: parsed.data,
      slug: GLOBAL_ENTRY_SLUG,
      publishedAt: isScheduledDue ? row.scheduledAt : row.publishedAt,
    })
  }
  // Sections take part in reference and asset checks like any entry.
  const everything = [...included, ...sectionItems.values()]

  const slugsByCollection = new Map<string, Set<string>>()
  for (const item of included) {
    let slugs = slugsByCollection.get(item.collectionKey)
    if (!slugs) {
      slugs = new Set()
      slugsByCollection.set(item.collectionKey, slugs)
    }
    if (slugs.has(item.slug)) {
      errors.push(`${item.collectionKey}: duplicate slug "${item.slug}"`)
    }
    slugs.add(item.slug)
  }

  const entriesByUrl = new Map<string, IncludedEntry>()
  for (const item of included) {
    const url = entryPublicUrl(
      existingSite.productionUrl,
      item.routePattern,
      item.slug,
    )
    if (!url) continue
    const owner = entriesByUrl.get(url)
    if (owner) {
      errors.push(
        `Route collision: two pages use the same URL ${url}: "${owner.collectionKey}/${owner.slug}" and "${item.collectionKey}/${item.slug}". Change a page slug or content type route before publishing.`,
      )
    }
    entriesByUrl.set(url, item)
  }

  const includedById = new Map<string, IncludedEntry>()
  for (const item of everything) {
    includedById.set(item.row.id, item)
  }

  // One batched lookup replaces a query per embedded/linked asset.
  const assetIds = new Set<string>()
  const assetKeys = new Set<string>()
  for (const item of everything) {
    const ogImage = readEntrySeo(item.data).ogImage
    if (ogImage) assetIds.add(ogImage)
    for (const field of item.fields) {
      const value = item.data[field.key]
      if (field.type === 'richtext') {
        for (const key of richTextAssetRefs(value).storageKeys)
          assetKeys.add(key)
      } else if (
        field.type === 'image' &&
        typeof value === 'string' &&
        value !== ''
      ) {
        assetIds.add(value)
      }
    }
  }
  const assets = await loadAssetLookup(
    existingSite.organizationId,
    { ids: assetIds, storageKeys: assetKeys },
    connection,
  )

  for (const item of everything) {
    for (const field of item.fields) {
      if (field.type !== 'reference') continue
      const value = item.data[field.key]
      if (value == null || value === '') continue
      if (typeof value !== 'string') {
        errors.push(
          `${item.collectionKey}/${item.slug}: ${field.key}: expected an entry id`,
        )
        continue
      }
      const target = includedById.get(value)
      if (!target) {
        errors.push(
          `${item.collectionKey}/${item.slug}: ${field.key}: referenced entry is not in the snapshot`,
        )
        continue
      }
      if (field.collection && target.collectionKey !== field.collection) {
        errors.push(
          `${item.collectionKey}/${item.slug}: ${field.key}: referenced entry is not in "${field.collection}"`,
        )
      }
    }

    for (const field of item.fields) {
      if (
        field.type === 'richtext' &&
        !richTextAssetsAuthorizedFrom(item.data[field.key], assets)
      ) {
        errors.push(
          `${item.collectionKey}/${item.slug}: ${field.key}: embedded asset not found in this organization`,
        )
      }
      if (field.type !== 'image') continue
      const value = item.data[field.key]
      if (value == null || value === '') continue
      if (typeof value !== 'string') {
        errors.push(
          `${item.collectionKey}/${item.slug}: ${field.key}: expected an asset id`,
        )
        continue
      }
      if (!resolveAssetFromLookup(assets, value)) {
        errors.push(
          `${item.collectionKey}/${item.slug}: ${field.key}: asset not found`,
        )
      }
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors }
  }

  const collections: Record<string, SnapshotEntry[]> = {}
  for (const key of enabled.map((col) => col.key).sort()) {
    const items = included
      .filter((item) => item.collectionKey === key)
      .sort(compareSnapshotEntries)
    const converted: SnapshotEntry[] = []
    for (const item of items) {
      const data = await convertFields(item.fields, item.data, {
        includedById,
        connection,
        assets,
        siteId,
        organizationId: existingSite.organizationId,
        strict: true,
      })
      const ogImageId = readEntrySeo(item.data).ogImage
      converted.push({
        id: item.row.id,
        slug: item.slug,
        publishedAt: item.publishedAt?.toISOString() ?? null,
        data,
        seo: buildEntrySeo({
          fields: item.fields,
          data: item.data,
          converted: data,
          slug: item.slug,
          routePattern: item.routePattern,
          site: existingSite,
          // A missing OG image falls back to the hero image rather than
          // blocking the whole publication.
          ogImage: ogImageId
            ? (resolveAssetFromLookup(assets, ogImageId) ?? null)
            : null,
          publishedAt: item.publishedAt,
        }),
      })
    }
    collections[key] = converted
  }

  const globals: Record<string, SnapshotGlobal> = {}
  const globalSchema: Record<string, GlobalConfig> = {}
  for (const section of sections) {
    const item = sectionItems.get(section.key)
    const id = item?.row.id ?? unreadySections.get(section.key)
    if (!id) continue
    const data = item
      ? await convertFields(item.fields, item.data, {
          includedById,
          connection,
          assets,
          siteId,
          organizationId: existingSite.organizationId,
          strict: true,
        })
      : {}
    const seo = section.seoEnabled
      ? buildEntrySeo({
          fields: section.fields,
          data: item?.data ?? {},
          converted: data,
          slug: GLOBAL_ENTRY_SLUG,
          routePattern: '',
          url: globalPublicUrl(existingSite.productionUrl, section.previewPath),
          title: section.label,
          site: existingSite,
          ogImage: item ? resolveOgImage(item.data, assets) : null,
          publishedAt: item?.publishedAt ?? null,
        })
      : undefined
    globals[section.key] = {
      id,
      publishedAt: item?.publishedAt?.toISOString() ?? null,
      data,
      ...(seo ? { seo } : {}),
    }
    globalSchema[section.key] = {
      label: section.label,
      fields: structuredClone(section.fields),
      seo: section.seoEnabled,
      ...(section.previewPath ? { previewPath: section.previewPath } : {}),
    }
  }

  // Sections are hashed only when there are some, so a site without them
  // keeps the collections hash it always had.
  const hasGlobals = Object.keys(globals).length > 0
  const hash = hasGlobals
    ? hashContent({ collections, globals })
    : hashContent(collections)
  const snapshot: Snapshot = {
    publicationId: '',
    siteKey: existingSite.slug,
    createdAt: now.toISOString(),
    hash,
    collections,
    // Present only with sections. `globals` is hashed (see below); `globalSchema`
    // is not, like `schema`.
    ...(hasGlobals ? { globals, globalSchema } : {}),
    // Outside the hash: it describes the collections, it is not content.
    schema: buildSnapshotSchema(enabled),
    // Outside the hash: it is derived from the content.
    assets: await snapshotAssets(
      existingSite.organizationId,
      { ...collections, ...globalsAsEntryLists(globals) },
      connection,
    ),
  }

  return { ok: true, snapshot, hash, entryVersions }
}

/** Draft preview of one section (`data` is the draft, not the ready version). */
export async function buildPreviewGlobal(
  siteId: string,
  key: string,
): Promise<SnapshotGlobal | null> {
  const found = await getGlobalEntry(siteId, key)
  const [existingSite] = await db
    .select()
    .from(site)
    .where(eq(site.id, siteId))
    .limit(1)
  if (!found || !existingSite || !found.global.enabled) return null
  const { global, entry: row } = found

  const data = await convertFields(global.fields, row.draftData, {
    includedById: new Map(),
    siteId,
    organizationId: existingSite.organizationId,
    strict: false,
  })
  const seo = global.seoEnabled
    ? buildEntrySeo({
        fields: global.fields,
        data: row.draftData,
        converted: data,
        slug: GLOBAL_ENTRY_SLUG,
        routePattern: '',
        url: globalPublicUrl(existingSite.productionUrl, global.previewPath),
        title: global.label,
        site: existingSite,
        ogImage: await resolveOgImageValue(
          row.draftData,
          existingSite.organizationId,
        ),
        publishedAt: row.publishedAt,
      })
    : undefined

  return {
    id: row.id,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    data,
    ...(seo ? { seo } : {}),
  }
}

export async function buildPreviewEntry(
  siteId: string,
  collectionKey: string,
  slug: string,
): Promise<SnapshotEntry | null> {
  const col = await getCollection(siteId, collectionKey)
  const [existingSite] = await db
    .select()
    .from(site)
    .where(eq(site.id, siteId))
    .limit(1)
  if (!col || !existingSite) return null

  const [row] = await db
    .select()
    .from(entry)
    .where(and(eq(entry.collectionId, col.id), eq(entry.slug, slug)))
    .limit(1)
  if (!row) return null

  const data = await convertFields(col.fields, row.draftData, {
    includedById: new Map(),
    siteId,
    organizationId: existingSite.organizationId,
    strict: false,
  })
  const ogImageId = readEntrySeo(row.draftData).ogImage
  const ogImage: ImageValue | null = ogImageId
    ? ((await resolveAssetValue(ogImageId, existingSite.organizationId)) ??
      null)
    : null

  return {
    id: row.id,
    slug: row.slug,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    data,
    seo: buildEntrySeo({
      fields: col.fields,
      data: row.draftData,
      converted: data,
      slug: row.slug,
      routePattern: col.routePattern,
      site: existingSite,
      ogImage,
      publishedAt: row.publishedAt,
    }),
  }
}

function compareSnapshotEntries(a: IncludedEntry, b: IncludedEntry) {
  const aAt = a.publishedAt?.toISOString() ?? ''
  const bAt = b.publishedAt?.toISOString() ?? ''
  if (aAt !== bAt) return bAt.localeCompare(aAt)
  return a.slug.localeCompare(b.slug)
}

async function convertFields(
  fields: Field[],
  data: EntryData,
  options: {
    includedById: Map<string, IncludedEntry>
    siteId: string
    connection?: Pick<typeof db, 'select'>
    /** Preloaded assets (snapshot builds); otherwise each asset is queried. */
    assets?: AssetLookup
    organizationId: string
    strict: boolean
  },
): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = withoutSeo(
    pickDeclaredFields(fields, data),
  )

  for (const field of fields) {
    const value = data[field.key]
    if (field.type === 'richtext') {
      const authorized = options.assets
        ? richTextAssetsAuthorizedFrom(value, options.assets)
        : await richTextAssetsAuthorized(
            value,
            options.organizationId,
            options.connection,
          )
      if (!authorized) {
        if (options.strict)
          throw new ValidationError([
            {
              path: field.key,
              message: 'Embedded asset not found in this organization',
            },
          ])
        out[field.key] = null
        continue
      }
      if (value == null || value === '') {
        out[field.key] = value
        continue
      }
      try {
        if (options.strict || validateRichText(value).length === 0) {
          out[field.key] = convertRichText(value)
        }
      } catch {
        // best-effort preview keeps the original value
      }
      continue
    }

    if (field.type === 'image') {
      if (typeof value !== 'string' || value.length === 0) {
        out[field.key] = value ?? null
        continue
      }
      const resolved = options.assets
        ? resolveAssetFromLookup(options.assets, value)
        : await resolveAssetValue(
            value,
            options.organizationId,
            options.connection,
          )
      if (resolved) {
        out[field.key] = resolved
      } else if (options.strict) {
        throw new ValidationError([
          { path: field.key, message: `asset not found: ${value}` },
        ])
      } else {
        out[field.key] = null
      }
      continue
    }

    if (field.type === 'reference') {
      if (typeof value !== 'string' || value.length === 0) {
        out[field.key] = value ?? null
        continue
      }
      const target = options.includedById.get(value)
      if (target) {
        const ref: ReferenceValue = {
          collection: target.collectionKey,
          slug: target.slug,
          id: target.row.id,
        }
        out[field.key] = ref
        continue
      }
      out[field.key] = null
      if (!options.strict && field.collection) {
        const [refRow] = await db
          .select({
            id: entry.id,
            slug: entry.slug,
            collectionKey: collection.key,
          })
          .from(entry)
          .innerJoin(collection, eq(entry.collectionId, collection.id))
          .where(
            and(
              eq(entry.id, value),
              eq(entry.siteId, options.siteId),
              ...(field.collection
                ? [eq(collection.key, field.collection)]
                : []),
            ),
          )
          .limit(1)
        if (refRow) {
          out[field.key] = {
            collection: refRow.collectionKey,
            slug: refRow.slug,
            id: refRow.id,
          } satisfies ReferenceValue
        }
      }
    }
  }

  return out
}

function hashContent(value: unknown) {
  return createHash('sha256')
    .update(JSON.stringify(sortValue(value)))
    .digest('hex')
}

function resolveOgImage(
  data: EntryData,
  assets: AssetLookup,
): ImageValue | null {
  const id = readEntrySeo(data).ogImage
  return id ? resolveAssetFromLookup(assets, id) : null
}

async function resolveOgImageValue(
  data: EntryData,
  organizationId: string,
): Promise<ImageValue | null> {
  const id = readEntrySeo(data).ogImage
  return id ? await resolveAssetValue(id, organizationId) : null
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue)
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(obj).sort()) {
      out[key] = sortValue(obj[key])
    }
    return out
  }
  return value
}
