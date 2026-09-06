import { createHash } from 'node:crypto'
import { and, eq, lte, or } from 'drizzle-orm'

import { db } from '#/db'
import { collection, entry, site } from '#/db/schema'
import type {
  EntryData,
  Field,
  ReferenceValue,
  Snapshot,
  SnapshotEntry,
} from '#/lib/types'
import { resolveAssetValue } from '#/server/assets'
import { convertRichText, validateRichText } from '#/server/richtext'

import { getCollection, listCollections } from './collections.ts'
import { NotFoundError } from './errors.ts'
import { validateEntryData } from './validation.ts'

type IncludedEntry = {
  collectionKey: string
  routePattern: string
  fields: Field[]
  row: typeof entry.$inferSelect
  data: EntryData
  publishedAt: Date | null
}

export async function buildSnapshot(
  siteId: string,
): Promise<
  { ok: true; snapshot: Snapshot; hash: string } | { ok: false; errors: string[] }
> {
  const [existingSite] = await db
    .select()
    .from(site)
    .where(eq(site.id, siteId))
    .limit(1)
  if (!existingSite) {
    throw new NotFoundError('Site not found')
  }

  const now = new Date()
  const enabled = await listCollections(siteId, { enabledOnly: true })
  const errors: string[] = []
  const included: IncludedEntry[] = []

  for (const col of enabled) {
    const rows = await db
      .select()
      .from(entry)
      .where(
        and(
          eq(entry.siteId, siteId),
          eq(entry.collectionId, col.id),
          or(
            eq(entry.status, 'published'),
            and(
              eq(entry.status, 'scheduled'),
              lte(entry.scheduledAt, now),
            ),
          ),
        ),
      )

    for (const row of rows) {
      const isScheduledDue = row.status === 'scheduled'
      const data = isScheduledDue ? row.draftData : row.publishedData
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
      included.push({
        collectionKey: col.key,
        routePattern: col.routePattern,
        fields: col.fields,
        row,
        data: parsed.data,
        publishedAt: row.publishedAt ?? (isScheduledDue ? row.scheduledAt : null),
      })
    }
  }

  const slugsByCollection = new Map<string, Set<string>>()
  for (const item of included) {
    let slugs = slugsByCollection.get(item.collectionKey)
    if (!slugs) {
      slugs = new Set()
      slugsByCollection.set(item.collectionKey, slugs)
    }
    if (slugs.has(item.row.slug)) {
      errors.push(
        `${item.collectionKey}: duplicate slug "${item.row.slug}"`,
      )
    }
    slugs.add(item.row.slug)
  }

  const slugsByRoute = new Map<string, Map<string, string>>()
  for (const item of included) {
    let bySlug = slugsByRoute.get(item.routePattern)
    if (!bySlug) {
      bySlug = new Map()
      slugsByRoute.set(item.routePattern, bySlug)
    }
    const owner = bySlug.get(item.row.slug)
    if (owner && owner !== item.collectionKey) {
      errors.push(
        `Route collision: ${item.routePattern} slug "${item.row.slug}" used by ${owner} and ${item.collectionKey}`,
      )
    }
    bySlug.set(item.row.slug, item.collectionKey)
  }

  const includedById = new Map<string, IncludedEntry>()
  for (const item of included) {
    includedById.set(item.row.id, item)
  }

  for (const item of included) {
    for (const field of item.fields) {
      if (field.type !== 'reference') continue
      const value = item.data[field.key]
      if (value == null || value === '') continue
      if (typeof value !== 'string') {
        errors.push(
          `${item.collectionKey}/${item.row.slug}: ${field.key}: expected an entry id`,
        )
        continue
      }
      const target = includedById.get(value)
      if (!target) {
        errors.push(
          `${item.collectionKey}/${item.row.slug}: ${field.key}: referenced entry is not in the snapshot`,
        )
        continue
      }
      if (field.collection && target.collectionKey !== field.collection) {
        errors.push(
          `${item.collectionKey}/${item.row.slug}: ${field.key}: referenced entry is not in "${field.collection}"`,
        )
      }
    }

    for (const field of item.fields) {
      if (field.type !== 'image') continue
      const value = item.data[field.key]
      if (value == null || value === '') continue
      if (typeof value !== 'string') {
        errors.push(
          `${item.collectionKey}/${item.row.slug}: ${field.key}: expected an asset id`,
        )
        continue
      }
      const resolved = await resolveAssetValue(value)
      if (!resolved) {
        errors.push(
          `${item.collectionKey}/${item.row.slug}: ${field.key}: asset not found`,
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
      converted.push({
        id: item.row.id,
        slug: item.row.slug,
        publishedAt: item.publishedAt?.toISOString() ?? null,
        data: await convertFields(item.fields, item.data, {
          includedById,
          strict: true,
        }),
      })
    }
    collections[key] = converted
  }

  const hash = hashCollections(collections)
  const snapshot: Snapshot = {
    publicationId: '',
    siteKey: existingSite.slug,
    createdAt: now.toISOString(),
    hash,
    collections,
  }

  return { ok: true, snapshot, hash }
}

export async function buildPreviewEntry(
  siteId: string,
  collectionKey: string,
  slug: string,
): Promise<SnapshotEntry | null> {
  const col = await getCollection(siteId, collectionKey)
  if (!col) return null

  const [row] = await db
    .select()
    .from(entry)
    .where(and(eq(entry.collectionId, col.id), eq(entry.slug, slug)))
    .limit(1)
  if (!row) return null

  const data = await convertFields(col.fields, row.draftData, {
    includedById: new Map(),
    strict: false,
  })

  return {
    id: row.id,
    slug: row.slug,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    data,
  }
}

function compareSnapshotEntries(a: IncludedEntry, b: IncludedEntry) {
  const aAt = a.publishedAt?.toISOString() ?? ''
  const bAt = b.publishedAt?.toISOString() ?? ''
  if (aAt !== bAt) return bAt.localeCompare(aAt)
  return a.row.slug.localeCompare(b.row.slug)
}

async function convertFields(
  fields: Field[],
  data: EntryData,
  options: {
    includedById: Map<string, IncludedEntry>
    strict: boolean
  },
): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = { ...data }

  for (const field of fields) {
    const value = data[field.key]
    if (field.type === 'richtext') {
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
      const resolved = await resolveAssetValue(value)
      if (resolved) {
        out[field.key] = resolved
      } else if (options.strict) {
        throw new Error(`asset not found: ${value}`)
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
          slug: target.row.slug,
          id: target.row.id,
        }
        out[field.key] = ref
        continue
      }
      if (!options.strict) {
        const [refRow] = await db
          .select({
            id: entry.id,
            slug: entry.slug,
            collectionKey: collection.key,
          })
          .from(entry)
          .innerJoin(collection, eq(entry.collectionId, collection.id))
          .where(eq(entry.id, value))
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

function hashCollections(collections: Record<string, SnapshotEntry[]>) {
  return createHash('sha256')
    .update(JSON.stringify(sortValue(collections)))
    .digest('hex')
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
