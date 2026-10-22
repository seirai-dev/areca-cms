import { and, eq, or, sql } from 'drizzle-orm'

import { db } from '#/db'
import { collection, entry } from '#/db/schema'
import { entryTitle } from '#/lib/content/utils'
import type { EntryData, EntryStatus } from '#/lib/types'
import { m } from '#/paraglide/messages'

import { NotFoundError } from './errors.ts'

export type InboundReference = {
  id: string
  title: string
  slug: string
  collectionKey: string
  status: EntryStatus
}

const JSON_COLUMNS = [
  entry.draftData,
  entry.publishedData,
  entry.scheduledData,
] as const

/** True when a JSON blob stores `entryId` on any of the given reference keys. */
export function dataReferencesEntry(
  data: EntryData | null | undefined,
  referenceKeys: readonly string[],
  entryId: string,
): boolean {
  if (data == null) return false
  return referenceKeys.some((key) => data[key] === entryId)
}

function jsonFieldEquals(
  column: (typeof JSON_COLUMNS)[number],
  key: string,
  entryId: string,
) {
  return sql`(${column} ->> ${key}) = ${entryId}`
}

/**
 * Same-site entries whose draft, published, or scheduled JSON stores this
 * id on a `type: 'reference'` field. Used to warn before delete; this pass
 * does not block the delete.
 *
 * `viewerIsAgency` decides whether disabled site content sections count and
 * show. Editors and owners never see them, as in the CMS, so their results
 * carry no id, key or title from a disabled section.
 */
export async function listInboundReferences(
  entryId: string,
  viewerIsAgency: boolean,
): Promise<InboundReference[]> {
  const target = (
    await db
      .select({ id: entry.id, siteId: entry.siteId })
      .from(entry)
      .where(eq(entry.id, entryId))
      .limit(1)
  ).at(0)
  if (!target) {
    throw new NotFoundError(m.server_entry_not_found())
  }

  // Site content sections count too: their fields can reference entries.
  const collections = await db
    .select({
      id: collection.id,
      key: collection.key,
      fields: collection.fields,
      kind: collection.kind,
      enabled: collection.enabled,
    })
    .from(collection)
    .where(eq(collection.siteId, target.siteId))
  const found: InboundReference[] = []
  const seen = new Set<string>()

  for (const col of collections) {
    if (!viewerIsAgency && col.kind === 'global' && !col.enabled) continue
    const keys = col.fields
      .filter((field) => field.type === 'reference')
      .map((field) => field.key)
    if (keys.length === 0) continue

    const fieldMatch = or(
      ...keys.flatMap((key) =>
        JSON_COLUMNS.map((column) => jsonFieldEquals(column, key, entryId)),
      ),
    )
    if (!fieldMatch) continue

    const rows = await db
      .select({
        id: entry.id,
        slug: entry.slug,
        status: entry.status,
        draftData: entry.draftData,
        publishedData: entry.publishedData,
        scheduledData: entry.scheduledData,
      })
      .from(entry)
      .where(
        and(
          eq(entry.siteId, target.siteId),
          eq(entry.collectionId, col.id),
          fieldMatch,
        ),
      )

    for (const row of rows) {
      const hits =
        dataReferencesEntry(row.draftData, keys, entryId) ||
        dataReferencesEntry(row.publishedData, keys, entryId) ||
        dataReferencesEntry(row.scheduledData, keys, entryId)
      if (!hits || seen.has(row.id)) continue
      seen.add(row.id)
      found.push({
        id: row.id,
        title: entryTitle(row.draftData, col.fields, row.slug),
        slug: row.slug,
        collectionKey: col.key,
        status: row.status,
      })
    }
  }

  found.sort(
    (a, b) => a.title.localeCompare(b.title) || a.slug.localeCompare(b.slug),
  )
  return found
}
