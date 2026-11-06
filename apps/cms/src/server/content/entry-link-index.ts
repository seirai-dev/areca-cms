import { and, eq, inArray } from 'drizzle-orm'

import { db } from '#/db'
import { collection, entry, entryLink, site } from '#/db/schema'
import { baseLocale } from '#/lib/content-locale'
import { entryTitle } from '#/lib/content/utils'
import type { EntryData, EntryStatus, Field, SiteLanguages } from '#/lib/types'
import { entryLinkTargets } from '#/server/richtext/entry-links'

import { localeCtxFor } from './locale-validation.ts'
import { mapRichTextValues } from './entry-links.ts'

/**
 * The entry link index (docs/design/rich-text-links.md, decision 18): one row
 * per entry link in the entry's draft, published and scheduled content, with
 * the language and field it sits in. It answers "what links to this entry"
 * without reading every document. Rows follow the content: each write that
 * changes an entry's data calls `syncEntryLinkIndex`. Deleting either entry
 * drops its rows through the foreign keys.
 */

/** The db or a transaction: the index is written from either. */
type Writer = Pick<typeof db, 'select' | 'insert' | 'delete'>
type Connection = Pick<typeof db, 'select'>

export type EntryLinkRow = {
  locale: string
  fieldKey: string
  targetEntryId: string
  anchor: string
}

/** The index rows of one entry's content. `languages` null on a single-language site. */
export async function linkRowsOf(
  datas: (EntryData | null | undefined)[],
  fields: Field[],
  languages: SiteLanguages | null,
): Promise<EntryLinkRow[]> {
  const ctx = languages ? localeCtxFor(languages, fields) : null
  const seen = new Map<string, EntryLinkRow>()
  for (const data of datas) {
    if (!data) continue
    const base = ctx ? baseLocale(data, ctx) : ''
    await mapRichTextValues(data, fields, (json, slot) => {
      const locale = slot.locale ?? base
      for (const target of entryLinkTargets(json)) {
        const row: EntryLinkRow = {
          locale,
          fieldKey: slot.field,
          targetEntryId: target.entryId,
          anchor: target.anchor ?? '',
        }
        seen.set(
          `${row.locale}|${row.fieldKey}|${row.targetEntryId}|${row.anchor}`,
          row,
        )
      }
      return json
    })
  }
  return [...seen.values()]
}

/** Keeps only rows whose target is an entry of the same site (the foreign key needs it). */
async function existingTargets(
  connection: Connection,
  siteId: string,
  ids: string[],
): Promise<Set<string>> {
  if (ids.length === 0) return new Set()
  const rows = await connection
    .select({ id: entry.id })
    .from(entry)
    .where(and(eq(entry.siteId, siteId), inArray(entry.id, ids)))
  return new Set(rows.map((row) => row.id))
}

/**
 * Rewrites one entry's rows from its current content. Call it inside the
 * transaction that changed the entry.
 */
export async function syncEntryLinkIndex(tx: Writer, entryId: string) {
  const row = (
    await tx
      .select({
        siteId: entry.siteId,
        draftData: entry.draftData,
        publishedData: entry.publishedData,
        scheduledData: entry.scheduledData,
        fields: collection.fields,
        languages: site.languages,
      })
      .from(entry)
      .innerJoin(collection, eq(entry.collectionId, collection.id))
      .innerJoin(site, eq(entry.siteId, site.id))
      .where(eq(entry.id, entryId))
      .limit(1)
  ).at(0)
  if (!row) return

  const rows = await linkRowsOf(
    [row.draftData, row.publishedData, row.scheduledData],
    row.fields,
    row.languages ?? null,
  )
  const targets = await existingTargets(tx, row.siteId, [
    ...new Set(rows.map((item) => item.targetEntryId)),
  ])
  await tx.delete(entryLink).where(eq(entryLink.sourceEntryId, entryId))
  const values = rows
    .filter((item) => targets.has(item.targetEntryId))
    .map((item) => ({
      siteId: row.siteId,
      sourceEntryId: entryId,
      locale: item.locale,
      fieldKey: item.fieldKey,
      targetEntryId: item.targetEntryId,
      anchor: item.anchor,
    }))
  if (values.length > 0) {
    await tx.insert(entryLink).values(values).onConflictDoNothing()
  }
}

/**
 * Rebuilds the whole index of one site from its entries. The migration cannot
 * do this in SQL (it reads each field's type from the collection), so it is
 * run after a schema change or a language change that moves content between
 * slots (`scripts/rebuild-entry-link-index.ts`).
 */
export async function rebuildEntryLinkIndex(
  connection: Writer,
  siteId: string,
): Promise<number> {
  const siteRow = (
    await connection
      .select({ languages: site.languages })
      .from(site)
      .where(eq(site.id, siteId))
      .limit(1)
  ).at(0)
  if (!siteRow) return 0
  await connection.delete(entryLink).where(eq(entryLink.siteId, siteId))

  const entries = await connection
    .select({
      id: entry.id,
      draftData: entry.draftData,
      publishedData: entry.publishedData,
      scheduledData: entry.scheduledData,
      fields: collection.fields,
    })
    .from(entry)
    .innerJoin(collection, eq(entry.collectionId, collection.id))
    .where(eq(entry.siteId, siteId))

  let written = 0
  for (const item of entries) {
    const rows = await linkRowsOf(
      [item.draftData, item.publishedData, item.scheduledData],
      item.fields,
      siteRow.languages ?? null,
    )
    const targets = await existingTargets(connection, siteId, [
      ...new Set(rows.map((row) => row.targetEntryId)),
    ])
    const values = rows
      .filter((row) => targets.has(row.targetEntryId))
      .map((row) => ({
        siteId,
        sourceEntryId: item.id,
        locale: row.locale,
        fieldKey: row.fieldKey,
        targetEntryId: row.targetEntryId,
        anchor: row.anchor,
      }))
    if (values.length > 0) {
      await connection.insert(entryLink).values(values).onConflictDoNothing()
      written += values.length
    }
  }
  return written
}

export type InboundLink = {
  id: string
  title: string
  slug: string
  collectionKey: string
  status: EntryStatus
  /** A site content section that is switched off. Only agencies see those. */
  disabledSection: boolean
}

/**
 * Other entries whose rich text links to this one, from the index. The
 * entry itself is left out. Does not filter disabled sections: the caller does.
 */
export async function listInboundLinks(
  targetEntryId: string,
): Promise<InboundLink[]> {
  const rows = await db
    .select({
      id: entry.id,
      slug: entry.slug,
      status: entry.status,
      draftData: entry.draftData,
      collectionKey: collection.key,
      fields: collection.fields,
      kind: collection.kind,
      enabled: collection.enabled,
    })
    .from(entryLink)
    .innerJoin(entry, eq(entryLink.sourceEntryId, entry.id))
    .innerJoin(collection, eq(entry.collectionId, collection.id))
    .where(eq(entryLink.targetEntryId, targetEntryId))
  const seen = new Set<string>()
  const found: InboundLink[] = []
  for (const row of rows) {
    if (row.id === targetEntryId || seen.has(row.id)) continue
    seen.add(row.id)
    found.push({
      id: row.id,
      title: entryTitle(row.draftData, row.fields, row.slug),
      slug: row.slug,
      collectionKey: row.collectionKey,
      status: row.status,
      disabledSection: row.kind === 'global' && !row.enabled,
    })
  }
  return found
}
