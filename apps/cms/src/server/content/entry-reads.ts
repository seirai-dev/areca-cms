import { and, desc, eq, ilike, isNotNull, or, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'

import { db } from '#/db'
import { collection, entry, site, user } from '#/db/schema'
import type { EntryData, EntryStatus, SiteLanguages } from '#/lib/types'
import { summaryFromParts, toEntrySummary } from '#/lib/content/entry-summary'
import type { EntrySummary } from '#/lib/content/entry-summary'
import { firstTextField } from '#/lib/content/utils'
import { isMultilingual } from '#/lib/site-languages'
import { m } from '#/paraglide/messages'

import { getCollection } from './collections.ts'
import { NotFoundError } from './errors.ts'
import { notCompleteInLocale } from './missing-language.ts'

/** Entry reads: one entry, and the list pages and counts of a site. */

export type ListEntriesOptions = {
  status?: EntryStatus
  /** Approved reference targets only; do not combine with `status`. */
  referenceTargets?: boolean
  search?: string
  /**
   * Entries whose draft is not complete in this language (any state:
   * empty, partial or missing a required field). Ignored when the site has
   * no such language, so a stale filter in a URL still shows the list.
   */
  missingLanguage?: string
  limit?: number
  offset?: number
  /**
   * The site's languages, when the caller already read the site (the access
   * check does). Saves a read; omitted, they are loaded.
   */
  languages?: SiteLanguages | null
}

/**
 * The collection, the site's languages and the WHERE clause that both list
 * reads share, so a page and its `total` always count the same rows.
 */
async function listScope(
  siteId: string,
  collectionKey: string,
  options: ListEntriesOptions,
) {
  const col = await getCollection(siteId, collectionKey)
  if (!col) {
    throw new NotFoundError(m.server_collection_not_found())
  }
  const languages =
    options.languages !== undefined
      ? options.languages
      : ((
          await db
            .select({ languages: site.languages })
            .from(site)
            .where(eq(site.id, siteId))
            .limit(1)
        ).at(0)?.languages ?? null)

  const filters = [eq(entry.siteId, siteId), eq(entry.collectionId, col.id)]
  if (options.referenceTargets) {
    filters.push(
      or(eq(entry.status, 'published'), eq(entry.status, 'scheduled'))!,
      isNotNull(entry.publishedData),
      isNotNull(entry.publishedSlug),
      sql`${entry.publishedSlug} <> ''`,
    )
  } else if (options.status) {
    filters.push(eq(entry.status, options.status))
  }
  if (options.search) {
    const term = `%${options.search}%`
    filters.push(
      or(ilike(entry.slug, term), sql`${entry.draftData}::text ilike ${term}`)!,
    )
  }
  if (
    options.missingLanguage &&
    languages?.all.includes(options.missingLanguage)
  ) {
    // Completeness is one predicate on the draft, so paging and `total` stay
    // exact and the database reads only the rows of the page.
    filters.push(
      notCompleteInLocale(options.missingLanguage, {
        main: languages.main,
        all: languages.all,
        fields: col.fields,
      }),
    )
  }
  return { col, languages, where: and(...filters) }
}

/**
 * Full entry rows of one collection, newest first. Used by the MCP tools and
 * other server callers that need the whole record. The UI reads
 * `listEntrySummaries`.
 */
export async function listEntries(
  siteId: string,
  collectionKey: string,
  options: ListEntriesOptions = {},
) {
  const limit = options.limit ?? 50
  const offset = options.offset ?? 0
  const { where } = await listScope(siteId, collectionKey, options)

  const rows = await db
    .select({ entry, updatedByName: user.name })
    .from(entry)
    .leftJoin(user, eq(entry.updatedBy, user.id))
    .where(where)
    .orderBy(desc(entry.updatedAt), entry.slug)
    .limit(limit)
    .offset(offset)
  const items = rows.map((row) => ({
    ...row.entry,
    updatedByName: row.updatedByName,
  }))
  return { items, total: await countWhere(where) }
}

/**
 * One page of list summaries (see `EntrySummary`), in the same order and with
 * the same `total` as `listEntries`. Only the columns the summary needs are
 * read: no origin baseline and no scheduled draft.
 */
export async function listEntrySummaries(
  siteId: string,
  collectionKey: string,
  options: ListEntriesOptions = {},
): Promise<{ items: EntrySummary[]; total: number }> {
  const limit = options.limit ?? 50
  const offset = options.offset ?? 0
  const { col, languages, where } = await listScope(
    siteId,
    collectionKey,
    options,
  )

  const multilingual = isMultilingual(languages)
  const textField = firstTextField(col.fields)
  const imageField = col.fields.find((field) => field.type === 'image')

  // The page's ids and the total in one statement. Only the small values a
  // summary shows are read from the documents: the title and cover strings and
  // whether the draft differs from what was marked ready (jsonb equality, the
  // same answer as `isEditedSinceReady`). The whole draft is only sent for a
  // multilingual site, whose coverage chips need it.
  const page = db.$with('page').as(
    db
      .select({
        id: entry.id,
        total: sql<number>`count(*) over ()`.as('total'),
      })
      .from(entry)
      .where(where)
      .orderBy(desc(entry.updatedAt), entry.slug)
      .limit(limit)
      .offset(offset),
  )
  const rows = await db
    .with(page)
    .select({
      id: entry.id,
      slug: entry.slug,
      status: entry.status,
      publishedSlug: entry.publishedSlug,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      scheduledAt: entry.scheduledAt,
      publishedAt: entry.publishedAt,
      updatedBy: entry.updatedBy,
      updatedByName: user.name,
      titleValue: jsonString(textField?.key),
      coverValue: jsonString(imageField?.key),
      editedSinceReady: sql<boolean>`(${entry.status} = 'published'
        and ${entry.publishedData} is not null
        and jsonb_typeof(${entry.publishedData}) <> 'null'
        and ${entry.draftData} is distinct from ${entry.publishedData})`,
      draftData: multilingual
        ? entry.draftData
        : sql<EntryData | null>`null::jsonb`,
      total: page.total,
    })
    .from(page)
    .innerJoin(entry, eq(entry.id, page.id))
    .leftJoin(user, eq(entry.updatedBy, user.id))
    .orderBy(desc(entry.updatedAt), entry.slug)
  const items = rows.map(({ total: _total, ...row }) =>
    summaryFromParts({
      collectionKey: col.key,
      fields: col.fields,
      languages,
      requiredLanguages: col.requiredLanguages,
      row,
    }),
  )

  const first = rows.at(0)
  if (first) return { items, total: Number(first.total) }
  // An empty page past the end still reports how many entries there are.
  if (offset === 0) return { items, total: 0 }
  return { items, total: await countWhere(where) }
}

async function countWhere(where: SQL | undefined): Promise<number> {
  const row = (
    await db
      .select({ count: sql<number>`count(*)::int` })
      .from(entry)
      .where(where)
  ).at(0)
  return row?.count ?? 0
}

/** The draft's value for `key` when it is a JSON string, else null. */
function jsonString(key: string | undefined) {
  if (!key) return sql<string | null>`null::text`
  return sql<
    string | null
  >`case when jsonb_typeof(${entry.draftData} -> ${key}::text) = 'string' then ${entry.draftData} ->> ${key}::text end`
}

/**
 * The newest entries across every collection of a site, for the overview: one
 * query instead of one list per collection. Same filters as the sidebar
 * (`enabledOnly` for non-admins, collections only, no sections). `total` counts
 * every matching entry, not just the page.
 */
export async function listSiteEntrySummaries(
  siteId: string,
  options: {
    enabledOnly: boolean
    languages: SiteLanguages | null
    status?: EntryStatus
    /** Leave out entries this person saved last, and never-saved ones. */
    excludeUpdatedBy?: string
    limit: number
  },
): Promise<{ items: EntrySummary[]; total: number }> {
  const filters = [eq(entry.siteId, siteId), eq(collection.kind, 'collection')]
  if (options.enabledOnly) filters.push(eq(collection.enabled, true))
  if (options.status) filters.push(eq(entry.status, options.status))
  if (options.excludeUpdatedBy) {
    filters.push(
      isNotNull(entry.updatedBy),
      sql`${entry.updatedBy} <> ${options.excludeUpdatedBy}`,
    )
  }
  const page = db.$with('page').as(
    db
      .select({
        id: entry.id,
        total: sql<number>`count(*) over ()`.as('total'),
      })
      .from(entry)
      .innerJoin(collection, eq(entry.collectionId, collection.id))
      .where(and(...filters))
      .orderBy(desc(entry.updatedAt), entry.slug, entry.id)
      .limit(options.limit),
  )
  // A page is at most a few rows, so the documents are read whole and the
  // summary is built by the shared helper.
  const rows = await db
    .with(page)
    .select({
      id: entry.id,
      slug: entry.slug,
      status: entry.status,
      draftData: entry.draftData,
      publishedData: entry.publishedData,
      publishedSlug: entry.publishedSlug,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      scheduledAt: entry.scheduledAt,
      publishedAt: entry.publishedAt,
      updatedBy: entry.updatedBy,
      updatedByName: user.name,
      collectionKey: collection.key,
      fields: collection.fields,
      requiredLanguages: collection.requiredLanguages,
      total: page.total,
    })
    .from(page)
    .innerJoin(entry, eq(entry.id, page.id))
    .innerJoin(collection, eq(entry.collectionId, collection.id))
    .leftJoin(user, eq(entry.updatedBy, user.id))
    .orderBy(desc(entry.updatedAt), entry.slug, entry.id)
  const items = rows.map(
    ({ collectionKey, fields, requiredLanguages, total: _total, ...row }) =>
      toEntrySummary({
        collectionKey,
        fields,
        languages: options.languages,
        requiredLanguages,
        row,
      }),
  )
  return { items, total: Number(rows.at(0)?.total ?? 0) }
}

/**
 * Entries per collection key of one site, in one grouped query. Counts every
 * entry the collection holds, whatever its status, as `listEntries` does with
 * no filter. `enabledOnly` leaves out switched-off collections (what a
 * non-admin sees).
 */
export async function countEntriesByCollection(
  siteId: string,
  options: { enabledOnly?: boolean } = {},
): Promise<Record<string, number>> {
  const filters = [
    eq(collection.siteId, siteId),
    eq(collection.kind, 'collection'),
  ]
  if (options.enabledOnly) filters.push(eq(collection.enabled, true))
  const rows = await db
    .select({
      key: collection.key,
      count: sql<number>`count(${entry.id})::int`,
    })
    .from(collection)
    .leftJoin(
      entry,
      and(eq(entry.collectionId, collection.id), eq(entry.siteId, siteId)),
    )
    .where(and(...filters))
    .groupBy(collection.id, collection.key)
  return Object.fromEntries(rows.map((row) => [row.key, row.count]))
}

/** One entry with its collection key, or null. */
export async function getEntry(id: string) {
  const row = (
    await db
      .select({ entry, collectionKey: collection.key })
      .from(entry)
      .innerJoin(collection, eq(entry.collectionId, collection.id))
      .where(eq(entry.id, id))
      .limit(1)
  ).at(0)
  return row ? { ...row.entry, collectionKey: row.collectionKey } : null
}
