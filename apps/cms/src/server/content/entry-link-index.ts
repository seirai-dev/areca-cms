import { and, eq, inArray, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'

import { db } from '#/db'
import { collection, entry, entryLink, site } from '#/db/schema'
import { baseLocale } from '#/lib/content-locale'
import { entryTitle } from '#/lib/content/utils'
import type { EntryData, EntryStatus, Field, SiteLanguages } from '#/lib/types'
import { entryLinkTargets } from '#/server/richtext/entry-links'

import { localeCtxFor } from './locale-validation.ts'
import { linkTargetSiteIds, mapRichTextValues } from './entry-links.ts'

/**
 * The entry link index (docs/design/rich-text-links.md, decision 18): one row
 * per entry link in the entry's draft, published and scheduled content, with
 * the language and field it sits in. It answers "what links to this entry"
 * without reading every document. Rows follow the content: each write that
 * changes an entry's data syncs that entry inside the same transaction, and
 * a schema or language change rebuilds the site. Deleting either entry drops
 * its rows through the foreign keys.
 */

/**
 * A transaction. The index is written only inside the transaction that changes
 * the content it is computed from, so a failure cannot leave the two apart.
 */
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]
type Connection = Pick<typeof db, 'select'>

/**
 * Serializes the link-index writers of one site. Lock order for every
 * transaction that writes `entry_link` rows, or takes the site row lock and
 * then changes entries (it can wait on a row that an index insert needs):
 *
 *   1. this lock (`lockSiteLinkIndex`), first: before any row write or row lock;
 *   2. the organization's asset lock (`assets/usage.ts`): shared for saves,
 *      exclusive for dev-env push, copy, reset and delete;
 *   3. the site row (`FOR NO KEY UPDATE`, see `setSiteLanguages`);
 *   4. entry rows, in id order (`lockedEntryRows`).
 *
 * Why: an index insert needs KEY SHARE on its source entry, target entry and
 * site rows (foreign keys). Two saves that each change their slug hold their
 * own entry row with FOR UPDATE and wait for the other's KEY SHARE: a cycle
 * (40P01). With this lock, the writers of one site run one at a time, so no
 * two of them hold a row that the other needs. Other sites are not affected.
 */
export async function lockSiteLinkIndex(tx: Tx, siteId: string) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`site-link-index:${siteId}`}, 0))`,
  )
}

/** Ids and rows per query or insert, to stay under the driver's bind-parameter limit. */
const CHUNK = 1000

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

function chunksOf<T>(items: T[]): T[][] {
  const out: T[][] = []
  for (let start = 0; start < items.length; start += CHUNK) {
    out.push(items.slice(start, start + CHUNK))
  }
  return out
}

/**
 * The ids among `ids` that are entries a link in the site may point at (see
 * `linkTargetSiteIds`). The foreign key needs them to exist.
 */
async function existingTargets(
  connection: Connection,
  siteId: string,
  ids: string[],
): Promise<Set<string>> {
  const sites = await linkTargetSiteIds(connection, siteId)
  const found = new Set<string>()
  for (const chunk of chunksOf(ids)) {
    const rows = await connection
      .select({ id: entry.id })
      .from(entry)
      .where(and(inArray(entry.siteId, sites), inArray(entry.id, chunk)))
    for (const row of rows) found.add(row.id)
  }
  return found
}

/** One source entry's rows, ready to insert. */
type SourceRows = {
  siteId: string
  sourceEntryId: string
  rows: EntryLinkRow[]
}

/**
 * Inserts the rows of many sources: one target lookup per site and one insert
 * per chunk, whatever the number of sources. Rows whose target is not an entry
 * of the site are left out. Returns the number of rows written.
 */
async function insertSourceRows(
  tx: Tx,
  sources: SourceRows[],
): Promise<number> {
  const bySite = new Map<string, SourceRows[]>()
  for (const source of sources) {
    const group = bySite.get(source.siteId) ?? []
    group.push(source)
    bySite.set(source.siteId, group)
  }
  let written = 0
  for (const [siteId, group] of bySite) {
    const targets = await existingTargets(tx, siteId, [
      ...new Set(
        group.flatMap((source) => source.rows.map((row) => row.targetEntryId)),
      ),
    ])
    const values = group.flatMap((source) =>
      source.rows
        .filter((row) => targets.has(row.targetEntryId))
        .map((row) => ({
          siteId,
          sourceEntryId: source.sourceEntryId,
          locale: row.locale,
          fieldKey: row.fieldKey,
          targetEntryId: row.targetEntryId,
          anchor: row.anchor,
        })),
    )
    for (const chunk of chunksOf(values)) {
      await tx.insert(entryLink).values(chunk).onConflictDoNothing()
    }
    written += values.length
  }
  return written
}

/**
 * The entries matching `where`, each with its content, locked in id order, so
 * no save can change them until the transaction ends.
 *
 * `FOR NO KEY UPDATE`, not `FOR UPDATE`: the index rows of these entries need
 * KEY SHARE on their target entries and on the site (foreign keys). FOR UPDATE
 * conflicts with KEY SHARE, so two saves that link to each other would each
 * block the other's insert (40P01). FOR NO KEY UPDATE still serializes writers
 * of the same entry, and does not conflict with KEY SHARE.
 *
 * The lock order is in `lockSiteLinkIndex`: the caller has already taken the
 * site's link-index lock, then the site row, before this runs.
 */
async function lockedEntryRows(tx: Tx, where: SQL | undefined) {
  return tx
    .select({
      id: entry.id,
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
    .where(where)
    .orderBy(entry.id)
    .for('no key update', { of: entry })
}

async function sourceRowsOf(
  row: Awaited<ReturnType<typeof lockedEntryRows>>[number],
): Promise<SourceRows> {
  return {
    siteId: row.siteId,
    sourceEntryId: row.id,
    rows: await linkRowsOf(
      [row.draftData, row.publishedData, row.scheduledData],
      row.fields,
      row.languages ?? null,
    ),
  }
}

/**
 * Rewrites the rows of the given entries from their current content, in one
 * transaction with the writes that changed them. The entry rows are locked
 * first, so a concurrent save waits and the content read here is the latest.
 * Other entries' rows are not touched.
 */
export async function syncEntryLinkIndexes(tx: Tx, entryIds: string[]) {
  const ids = [...new Set(entryIds)]
  for (const chunk of chunksOf(ids)) {
    const rows = await lockedEntryRows(tx, inArray(entry.id, chunk))
    if (rows.length === 0) continue
    await tx.delete(entryLink).where(
      inArray(
        entryLink.sourceEntryId,
        rows.map((row) => row.id),
      ),
    )
    const sources: SourceRows[] = []
    for (const row of rows) sources.push(await sourceRowsOf(row))
    await insertSourceRows(tx, sources)
  }
}

/** Rewrites one entry's rows from its current content. See `syncEntryLinkIndexes`. */
export async function syncEntryLinkIndex(tx: Tx, entryId: string) {
  await syncEntryLinkIndexes(tx, [entryId])
}

/**
 * Rebuilds the whole index of one site from its entries. Needed after a schema
 * or language change, which can reshape any entry's rows. The migration cannot
 * do this in SQL (it reads each field's type from the collection), so it is
 * run after such a change, and by `scripts/rebuild-entry-link-index.ts`.
 * Locks every entry of the site first, so no save can run during the rebuild.
 * The caller holds `lockSiteLinkIndex` and the site row (`FOR NO KEY UPDATE`)
 * before this runs; the order is in `lockSiteLinkIndex`.
 */
export async function rebuildEntryLinkIndex(
  tx: Tx,
  siteId: string,
): Promise<number> {
  const rows = await lockedEntryRows(tx, eq(entry.siteId, siteId))
  await tx.delete(entryLink).where(eq(entryLink.siteId, siteId))
  const sources: SourceRows[] = []
  for (const row of rows) sources.push(await sourceRowsOf(row))
  return insertSourceRows(tx, sources)
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
  const target = (
    await db
      .select({ siteId: entry.siteId })
      .from(entry)
      .where(eq(entry.id, targetEntryId))
      .limit(1)
  ).at(0)
  if (!target) return []
  // Only links in the target's own site: a development environment's links to
  // a production entry are not links to it from production.
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
    .where(
      and(
        eq(entryLink.targetEntryId, targetEntryId),
        eq(entryLink.siteId, target.siteId),
      ),
    )
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
