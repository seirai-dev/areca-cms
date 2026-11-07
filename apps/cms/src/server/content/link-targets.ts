import { and, desc, eq, ne, or, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'

import { db } from '#/db'
import { collection, entry, site } from '#/db/schema'
import { firstTextField } from '#/lib/content/utils'
import {
  I18N_KEY,
  isTranslatable,
  LOCALE_KEY,
  readLocale,
  SLUG_KEY,
} from '#/lib/content-locale'
import { previewOrigin } from '#/lib/preview-url'
import type { EntryData, EntryStatus, Field, SiteLanguages } from '#/lib/types'
import { richTextHeadings } from '#/server/richtext/entry-links'

import {
  entryLinkPath,
  linkTargetSiteIds,
  loadLinkTargets,
  placeLinkTarget,
} from './entry-links.ts'
import type { LinkTargetRow } from './entry-links.ts'
import { loadSiteLanguages, localeCtxFor } from './locale-validation.ts'

/**
 * Finding the entries a rich text link can point at, for the editor's link
 * field: search by title and slug, typed paths and own-domain URLs, the
 * headings of an entry, and whether the links in a text still work.
 * Read-only; the callers check access first. docs/design/rich-text-links.md,
 * decisions 12 to 14.
 */

/** Rows an exact-path lookup reads per collection (one entry is the address). */
const EXACT_LIMIT = 10

/** One entry a link can point at, as the editor lists it. */
export type LinkTargetOption = {
  entryId: string
  /** Collection key: the `collection` attribute of an entry link. */
  collection: string
  collectionLabel: string
  /** The title in the language asked for, else the main language's. */
  title: string
  /** The slug in the language asked for, else the main language's. */
  slug: string
  /** The main-language slug and the approved slug: the status rules use them. */
  mainSlug: string
  publishedSlug: string | null
  status: EntryStatus
  /** The path in the language of the link, with no locale prefix and no section. */
  path: string
}

export type LinkTargetSearch = {
  entries: LinkTargetOption[]
  /** A typed path or own-domain URL that is the address of this entry. */
  resolved: { entry: LinkTargetOption; anchor: string | null } | null
  /** An own-domain URL as a site path (with its section), to keep as a plain link. */
  ownPath: string | null
}

export type LinkHeading = { id: string; text: string; level: number }

export type LinkState = 'ok' | 'gone' | 'missing-section'

export type LinkCheckInput = { entryId: string; anchor: string | null }

export type LinkCheckResult = LinkCheckInput & {
  /** `gone`: the entry is archived, deleted or has no page. */
  state: LinkState
  target: LinkTargetOption | null
}

type ParsedQuery =
  | { kind: 'words'; text: string }
  | {
      kind: 'path'
      path: string
      anchor: string | null
      ownPath: string | null
    }
  /** A site path with a query string: a plain link, never an entry. */
  | { kind: 'plain'; ownPath: string }
  | { kind: 'external' }

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`)
}

function safeDecode(value: string) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/** The hosts an own-domain link may use: the production and the preview address. */
function siteHosts(row: { productionUrl: string; previewUrl: string | null }) {
  const hosts = new Set<string>()
  for (const origin of [row.productionUrl, previewOrigin(row)]) {
    if (!origin) continue
    try {
      hosts.add(new URL(origin).host.toLowerCase())
    } catch {
      // A site without a usable address matches no own-domain link.
    }
  }
  return hosts
}

/**
 * What the query asks for. A path starts with one `/`; an https URL on the
 * site's own host is read as the same path (with its query and fragment).
 * Entry links store no query string, so a path with a query is a plain link
 * to that path (`plain`, with the path as typed, query included). Any other
 * URL is not an entry. Everything else is words to search for.
 */
export function parseLinkQuery(query: string, hosts: Set<string>): ParsedQuery {
  const text = query.trim()
  let sitePath: string | null = null
  if (text.startsWith('/') && !text.startsWith('//')) {
    sitePath = text
  } else if (/^https?:\/\//i.test(text)) {
    let url: URL | null = null
    try {
      url = new URL(text)
    } catch {
      url = null
    }
    if (!url || !hosts.has(url.host.toLowerCase())) return { kind: 'external' }
    sitePath = `${url.pathname}${url.search}${url.hash}`
  }
  if (sitePath !== null) {
    const hash = sitePath.indexOf('#')
    const path = hash === -1 ? sitePath : sitePath.slice(0, hash)
    if (path.includes('?')) return { kind: 'plain', ownPath: sitePath }
    const anchor = hash === -1 ? null : sitePath.slice(hash + 1) || null
    return {
      kind: 'path',
      path,
      anchor,
      ownPath: /^https?:\/\//i.test(text) ? sitePath : null,
    }
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(text) || text.startsWith('//')) {
    return { kind: 'external' }
  }
  return { kind: 'words', text: text.split('#')[0].trim() }
}

/** The title of a language's view, or null when it has none. */
function titleIn(data: EntryData, fields: Field[]): string | null {
  const field = firstTextField(fields)
  const value = field ? data[field.key] : undefined
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

type Ctx = { languages: SiteLanguages | null; locale: string | null }

/**
 * The title and slug an entry shows in the link field, in `ctx.locale`. This is
 * the one locale rule of the field; `viewValueSql`, `localizedTitleSql` and
 * `localizedSlugSql` mirror it in SQL, so the search and the row agree.
 * - The language's view is `readLocale`: the base values when the language is
 *   the base one (`$locale`, else the main language), else its translation.
 *   Without languages or a locale, the base values are the view.
 * - The title is the view's title when it is not blank, else the base title.
 *   A title field that is not translatable is always the base value.
 * - The slug is the view's `$slug` when it is not empty, else the entry's slug.
 */
function labelsOf(
  row: Pick<LinkTargetRow, 'draftData' | 'fields' | 'slug'>,
  ctx: Ctx,
): { title: string; slug: string } {
  const { languages, locale } = ctx
  const lctx = languages ? localeCtxFor(languages, row.fields) : null
  const view =
    lctx && locale ? readLocale(row.draftData, locale, lctx) : row.draftData
  const localSlug = view[SLUG_KEY]
  return {
    title:
      titleIn(view, row.fields) ??
      titleIn(row.draftData, row.fields) ??
      row.slug,
    slug:
      typeof localSlug === 'string' && localSlug !== '' ? localSlug : row.slug,
  }
}

/**
 * The option for one entry in the editor's language: the title and slug from
 * `labelsOf`. The path follows the release rule (`placeLinkTarget`), so it is
 * where the link goes.
 */
function optionOf(row: LinkTargetRow, ctx: Ctx): LinkTargetOption {
  const { languages, locale } = ctx
  const { title, slug } = labelsOf(row, ctx)
  const placed = placeLinkTarget(
    {
      data: row.draftData,
      fields: row.fields,
      slug: row.slug,
      routePattern: row.routePattern,
      localizedRoutes: row.localizedRoutes,
    },
    languages,
    locale,
  )
  return {
    entryId: row.id,
    collection: row.collectionKey,
    collectionLabel: row.collectionLabel,
    title,
    slug,
    mainSlug: row.slug,
    publishedSlug: row.publishedSlug,
    status: row.status,
    path: entryLinkPath(placed.route, placed.slug, null),
  }
}

/** Every path an entry answers to: one per language it ships in, plus the main one. */
function pathsOf(row: LinkTargetRow, ctx: Ctx): string[] {
  const languages = ctx.languages
  const codes = languages ? [languages.main, ...languages.all] : [null]
  const paths = new Set<string>()
  for (const code of codes) {
    const placed = placeLinkTarget(
      {
        data: row.draftData,
        fields: row.fields,
        slug: row.slug,
        routePattern: row.routePattern,
        localizedRoutes: row.localizedRoutes,
      },
      languages,
      code,
    )
    paths.add(entryLinkPath(placed.route, placed.slug, null))
  }
  return [...paths]
}

/** A routed collection a search reads: one query each. */
type RoutedCollection = {
  id: string
  key: string
  label: string
  routePattern: string
  localizedRoutes: Record<string, string> | null
  fields: Field[]
}

async function routedCollections(
  siteId: string,
  enabledOnly: boolean,
): Promise<RoutedCollection[]> {
  return db
    .select({
      id: collection.id,
      key: collection.key,
      label: collection.label,
      routePattern: collection.routePattern,
      localizedRoutes: collection.localizedRoutes,
      fields: collection.fields,
    })
    .from(collection)
    .where(
      and(
        eq(collection.siteId, siteId),
        eq(collection.kind, 'collection'),
        ne(collection.routePattern, ''),
        enabledOnly ? eq(collection.enabled, true) : undefined,
      ),
    )
}

/**
 * The value `key` has in the language `ctx.locale`, as `readLocale` reads it
 * (see `labelsOf`): the base value when the language is the base one, else its
 * translation. Null when the language has no value.
 */
function viewValueSql(key: string, ctx: Ctx): SQL<string | null> {
  const data = entry.draftData
  const { languages, locale } = ctx
  if (!locale || !languages) return sql`(${data} ->> ${key})`
  const base = sql`coalesce(nullif(${data} ->> ${LOCALE_KEY}, ''), ${languages.main})`
  return sql`(CASE WHEN ${base} = ${locale}
    THEN ${data} ->> ${key}
    ELSE ${data} #>> ARRAY[${I18N_KEY}, ${locale}, ${key}]::text[] END)`
}

/**
 * The title an entry shows (`labelsOf`), in SQL: the language's title when it
 * is not blank, else the base title. A title field that is not translatable is
 * always the base title.
 */
function localizedTitleSql(
  key: string,
  translatable: boolean,
  ctx: Ctx,
): SQL<string | null> {
  const base = sql<string | null>`(${entry.draftData} ->> ${key})`
  if (!translatable) return base
  const view = viewValueSql(key, ctx)
  return sql`(CASE WHEN ${view} ~ '[^[:space:]]' THEN ${view} ELSE ${base} END)`
}

/** The slug an entry shows (`labelsOf`), in SQL. */
function localizedSlugSql(ctx: Ctx): SQL<string | null> {
  return sql`coalesce(nullif(${viewValueSql(SLUG_KEY, ctx)}, ''), ${entry.slug})`
}

/** The entry columns a search reads. */
const entryColumns = {
  id: entry.id,
  siteId: entry.siteId,
  slug: entry.slug,
  status: entry.status,
  publishedSlug: entry.publishedSlug,
  draftData: entry.draftData,
  publishedData: entry.publishedData,
  scheduledData: entry.scheduledData,
  updatedAt: entry.updatedAt,
}

type EntryRow = {
  id: string
  siteId: string
  slug: string
  status: EntryStatus
  publishedSlug: string | null
  draftData: EntryData
  publishedData: EntryData | null
  scheduledData: EntryData | null
  updatedAt: Date
}

type CollectionCols = Pick<
  LinkTargetRow,
  | 'collectionKey'
  | 'collectionLabel'
  | 'collectionKind'
  | 'routePattern'
  | 'localizedRoutes'
  | 'fields'
>

/** A searched entry with its collection's columns; `rank` when the search ranks. */
type SearchedRow = EntryRow & CollectionCols & { rank?: number }

function rowOf<T extends EntryRow>(
  target: RoutedCollection,
  row: T,
): T & CollectionCols {
  return {
    ...row,
    collectionKey: target.key,
    collectionLabel: target.label,
    collectionKind: 'collection',
    routePattern: target.routePattern,
    localizedRoutes: target.localizedRoutes,
    fields: target.fields,
  }
}

/** Every language code an entry's slug may be stored under. */
function codesOf(languages: SiteLanguages | null): string[] {
  return languages ? [...new Set([languages.main, ...languages.all])] : []
}

/** The placeholder a route puts where the slug goes. */
const SLUG_TOKEN = '$slug'

/**
 * The paths an entry of `target` may answer to, as SQL. The main path is the
 * main route with the main slug. Each other language has its route
 * (`localizedRoutes`, else the main route) and its own slug (else the main
 * slug), read the way `readLocale` reads it. That is the path `placeLinkTarget`
 * gives a language that ships; a language that does not ship places on the
 * main path, which is listed already. So these cover every path `pathsOf` can
 * return. The caller still checks the paths of each row in TypeScript.
 */
function pathExprsSql(
  target: RoutedCollection,
  languages: SiteLanguages | null,
): SQL[] {
  const main = languages?.main ?? null
  const exprs: SQL[] = [
    sql`replace(${target.routePattern}, ${SLUG_TOKEN}, ${entry.slug})`,
  ]
  for (const code of codesOf(languages)) {
    if (code === main) continue
    const route = target.localizedRoutes?.[code] ?? target.routePattern
    const ownSlug = sql`CASE WHEN coalesce(nullif(${entry.draftData} ->> ${LOCALE_KEY}, ''), ${main}) = ${code}
      THEN ${entry.draftData} ->> ${SLUG_KEY}
      ELSE ${entry.draftData} #>> ARRAY[${I18N_KEY}, ${code}, ${SLUG_KEY}]::text[] END`
    exprs.push(
      sql`replace(${route}, ${SLUG_TOKEN}, coalesce(nullif(${ownSlug}, ''), ${entry.slug}))`,
    )
  }
  return exprs
}

/**
 * The entries of one collection with a path that starts with `wanted` (equal
 * to it when `exact`), newest first. The match happens in SQL, before the
 * limit, so entries whose path does not match cannot take a slot. Paths are
 * compared lower case, as `searchLinkTargets` does.
 */
async function searchCollectionByPath(
  siteId: string,
  target: RoutedCollection,
  wanted: string,
  exact: boolean,
  languages: SiteLanguages | null,
  limit: number,
): Promise<SearchedRow[]> {
  const pattern = exact ? wanted : `${escapeLike(wanted)}%`
  const matches = or(
    ...pathExprsSql(target, languages).map((path) =>
      exact
        ? sql`lower(${path}) = ${pattern}`
        : sql`lower(${path}) LIKE ${pattern}`,
    ),
  )
  const rows = await db
    .select(entryColumns)
    .from(entry)
    .where(
      and(
        eq(entry.siteId, siteId),
        eq(entry.collectionId, target.id),
        ne(entry.status, 'archived'),
        matches,
      ),
    )
    .orderBy(desc(entry.updatedAt), entry.slug)
    .limit(limit)
  return rows.map((row) => rowOf(target, row))
}

/**
 * The entries of one collection whose title or slug contains `term` (lower
 * case), best matches first, then the newest. Ranks: an exact title or slug,
 * a title or slug that starts with the term, a title word that starts with it,
 * then a title or slug that contains it. Without a term: the newest entries.
 */
async function searchCollectionByWords(
  siteId: string,
  target: RoutedCollection,
  ctx: Ctx,
  term: string,
  limit: number,
) {
  const titleField = firstTextField(target.fields)
  const title = titleField
    ? localizedTitleSql(titleField.key, isTranslatable(titleField), ctx)
    : sql<string | null>`NULL::text`
  const slug = localizedSlugSql(ctx)
  const contains = `%${escapeLike(term)}%`
  const matches = term
    ? or(
        sql`lower(${title}) LIKE ${contains}`,
        sql`lower(${slug}) LIKE ${contains}`,
      )
    : undefined
  const rank = term
    ? sql<number>`(CASE
        WHEN lower(${title}) = ${term} OR lower(${slug}) = ${term} THEN 0
        WHEN lower(${title}) LIKE ${`${escapeLike(term)}%`} THEN 1
        WHEN lower(${slug}) LIKE ${`${escapeLike(term)}%`} THEN 2
        WHEN lower(${title}) LIKE ${`% ${escapeLike(term)}%`} THEN 3
        ELSE 4 END)`
    : sql<number>`0::int`
  const rows = await db
    .select({ ...entryColumns, rank })
    .from(entry)
    .where(
      and(
        eq(entry.siteId, siteId),
        eq(entry.collectionId, target.id),
        ne(entry.status, 'archived'),
        matches,
      ),
    )
    .orderBy(rank, desc(entry.updatedAt), entry.slug)
    .limit(limit)
  return rows.map((row) => rowOf(target, row))
}

/**
 * The search behind the link field. `query` is what the editor typed:
 * - empty: the newest routed entries;
 * - words: entries whose title or slug matches, in the editor's language;
 * - `/…` or an own-domain URL: entries whose path starts with it, and the
 *   entry at exactly that path (`resolved`), with its section.
 */
export async function searchLinkTargets(
  siteId: string,
  input: {
    query: string
    locale: string | null
    limit: number
    enabledOnly: boolean
  },
): Promise<LinkTargetSearch> {
  const siteRow = (
    await db
      .select({
        languages: site.languages,
        productionUrl: site.productionUrl,
        previewUrl: site.previewUrl,
      })
      .from(site)
      .where(eq(site.id, siteId))
      .limit(1)
  ).at(0)
  const empty: LinkTargetSearch = { entries: [], resolved: null, ownPath: null }
  if (!siteRow) return empty
  const ctx: Ctx = { languages: siteRow.languages, locale: input.locale }
  const parsed = parseLinkQuery(input.query, siteHosts(siteRow))

  if (parsed.kind === 'external') return empty
  if (parsed.kind === 'plain') return { ...empty, ownPath: parsed.ownPath }

  if (parsed.kind === 'words') {
    // Each collection answers with its own best matches; the merged list keeps
    // the best of them, so a long collection cannot push a match out.
    const needle = parsed.text.toLowerCase()
    const hits = (
      await Promise.all(
        (await routedCollections(siteId, input.enabledOnly)).map((target) =>
          searchCollectionByWords(siteId, target, ctx, needle, input.limit),
        ),
      )
    )
      .flat()
      .sort(
        (a, b) =>
          a.rank - b.rank || b.updatedAt.getTime() - a.updatedAt.getTime(),
      )
    return {
      ...empty,
      entries: hits.slice(0, input.limit).map((hit) => optionOf(hit, ctx)),
    }
  }

  // A path: the entry at exactly this path, and the entries whose path starts
  // with it. Each collection is filtered in SQL on its paths; the paths of the
  // rows found are then checked again.
  const wanted = safeDecode(parsed.path).toLowerCase()
  const targets = await routedCollections(siteId, input.enabledOnly)
  const languages = siteRow.languages
  const newestFirst = (a: SearchedRow, b: SearchedRow) =>
    b.updatedAt.getTime() - a.updatedAt.getTime()
  const exactRows = (
    await Promise.all(
      targets.map((target) =>
        searchCollectionByPath(
          siteId,
          target,
          wanted,
          true,
          languages,
          EXACT_LIMIT,
        ),
      ),
    )
  )
    .flat()
    .sort(newestFirst)
  let resolved: LinkTargetSearch['resolved'] = null
  for (const row of exactRows) {
    const exact = pathsOf(row, ctx).some(
      (path) => safeDecode(path).toLowerCase() === wanted,
    )
    if (exact) {
      resolved = { entry: optionOf(row, ctx), anchor: parsed.anchor }
      break
    }
  }

  // One more row per collection than the list shows: the exact entry is left out.
  const prefixRows = (
    await Promise.all(
      targets.map((target) =>
        searchCollectionByPath(
          siteId,
          target,
          wanted,
          false,
          languages,
          input.limit + 1,
        ),
      ),
    )
  )
    .flat()
    .sort(newestFirst)
  const entries: LinkTargetOption[] = []
  for (const row of prefixRows) {
    if (entries.length >= input.limit) break
    if (resolved && row.id === resolved.entry.entryId) continue
    const starts = pathsOf(row, ctx).some((path) =>
      safeDecode(path).toLowerCase().startsWith(wanted),
    )
    if (starts) entries.push(optionOf(row, ctx))
  }
  return { entries, resolved, ownPath: parsed.ownPath }
}

/**
 * The headings of one entry in the language of the link: the same ids the
 * published page has. Null when the entry cannot be linked to.
 */
export async function linkTargetHeadings(
  siteId: string,
  entryId: string,
  locale: string | null,
): Promise<{ path: string; headings: LinkHeading[] } | null> {
  const row = (
    await loadLinkTargets(db, await linkTargetSiteIds(db, siteId), [entryId])
  ).get(entryId)
  if (!row || row.collectionKind === 'global' || row.routePattern === '')
    return null
  const languages = await loadSiteLanguages(siteId)
  return headingsOf(row, languages, locale)
}

function headingsOf(
  row: LinkTargetRow,
  languages: SiteLanguages | null,
  locale: string | null,
): { path: string; headings: LinkHeading[] } {
  const placed = placeLinkTarget(
    {
      data: row.draftData,
      fields: row.fields,
      slug: row.slug,
      routePattern: row.routePattern,
      localizedRoutes: row.localizedRoutes,
    },
    languages,
    locale,
  )
  const seen = new Set<string>()
  const headings: LinkHeading[] = []
  for (const field of row.fields) {
    if (field.type !== 'richtext') continue
    for (const heading of richTextHeadings(placed.view[field.key])) {
      if (seen.has(heading.id)) continue
      seen.add(heading.id)
      headings.push(heading)
    }
  }
  return { path: entryLinkPath(placed.route, placed.slug, null), headings }
}

/**
 * Whether each link in a text still works in `locale`. A link to an entry
 * that is archived, deleted or has no page is `gone`. A section that is not
 * among the target's headings in that language is `missing-section`. Targets
 * are looked up in the site and, for a development environment, its
 * production site.
 */
export async function checkLinkTargets(
  siteId: string,
  locale: string | null,
  links: LinkCheckInput[],
): Promise<LinkCheckResult[]> {
  if (links.length === 0) return []
  const languages = await loadSiteLanguages(siteId)
  const rows = await loadLinkTargets(
    db,
    await linkTargetSiteIds(db, siteId),
    links.map((link) => link.entryId),
  )
  const ctx: Ctx = { languages, locale }
  const headingIds = new Map<string, Set<string>>()
  return links.map((link) => {
    const row = rows.get(link.entryId)
    if (!row || row.collectionKind === 'global' || row.routePattern === '') {
      return { ...link, state: 'gone', target: null }
    }
    const target = optionOf(row, ctx)
    if (row.status === 'archived') return { ...link, state: 'gone', target }
    if (!link.anchor) return { ...link, state: 'ok', target }
    let ids = headingIds.get(row.id)
    if (!ids) {
      ids = new Set(
        headingsOf(row, languages, locale).headings.map((h) => h.id),
      )
      headingIds.set(row.id, ids)
    }
    return {
      ...link,
      state: ids.has(link.anchor) ? 'ok' : 'missing-section',
      target,
    }
  })
}
