import { and, desc, eq, ne, or, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'

import { db } from '#/db'
import { collection, entry, site } from '#/db/schema'
import { firstTextField } from '#/lib/content/utils'
import {
  I18N_KEY,
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

/** Every language code an entry's slug may be stored under. */
function codesOf(languages: SiteLanguages | null): string[] {
  return languages ? [...new Set([languages.main, ...languages.all])] : []
}

/** The placeholder a route puts where the slug goes. */
const SLUG_TOKEN = '$slug'

/**
 * The key of the collection's first text field, in SQL: `firstTextField`, the
 * field that gives the title. Null when the collection has no text field.
 */
function titleKeySql(): SQL<string | null> {
  return sql`(SELECT f.field ->> 'key' FROM jsonb_array_elements(${collection.fields}) WITH ORDINALITY AS f(field, ord) WHERE f.field ->> 'type' = 'text' ORDER BY f.ord LIMIT 1)`
}

/**
 * Whether that title field is translatable, as `isTranslatable` says: its own
 * switch, else on for text fields.
 */
function titleTranslatableSql(): SQL<boolean> {
  return sql`COALESCE((SELECT (f.field ->> 'translatable')::boolean FROM jsonb_array_elements(${collection.fields}) WITH ORDINALITY AS f(field, ord) WHERE f.field ->> 'type' = 'text' ORDER BY f.ord LIMIT 1), true)`
}

/**
 * The value `key` has in the language `ctx.locale`, as `readLocale` reads it
 * (see `labelsOf`): the base value when the language is the base one, else its
 * translation. Null when the language has no value.
 */
function viewValueSql(
  key: SQL<string | null> | string,
  ctx: Ctx,
): SQL<string | null> {
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
 * is translatable and not blank, else the base title.
 */
function localizedTitleSql(ctx: Ctx): SQL<string | null> {
  const key = titleKeySql()
  const base = sql<string | null>`(${entry.draftData} ->> ${key})`
  const view = viewValueSql(key, ctx)
  return sql<
    string | null
  >`(CASE WHEN ${titleTranslatableSql()} AND ${view} ~ '[^[:space:]]' THEN ${view} ELSE ${base} END)`
}

/** The slug an entry shows (`labelsOf`), in SQL. */
function localizedSlugSql(ctx: Ctx): SQL<string | null> {
  return sql`coalesce(nullif(${viewValueSql(SLUG_KEY, ctx)}, ''), ${entry.slug})`
}

/**
 * The paths an entry may answer to, in SQL: the main route with the main slug,
 * and for each other language its route (`localizedRoutes`, else the main
 * route) with its own slug (else the main slug), as `placeLinkTarget` places a
 * language that ships. A language that does not ship places on the main path,
 * which is listed already, so these cover every path `pathsOf` can return. The
 * caller still checks the paths of each row in TypeScript.
 */
function pathExprsSql(languages: SiteLanguages | null): SQL[] {
  const main = languages?.main ?? null
  const exprs: SQL[] = [
    sql`replace(${collection.routePattern}, ${SLUG_TOKEN}, ${entry.slug})`,
  ]
  for (const code of codesOf(languages)) {
    if (code === main) continue
    const route = sql`coalesce(${collection.localizedRoutes} ->> ${code}, ${collection.routePattern})`
    const slug = sql`coalesce(nullif(${viewValueSql(SLUG_KEY, { languages, locale: code })}, ''), ${entry.slug})`
    exprs.push(sql`replace(${route}, ${SLUG_TOKEN}, ${slug})`)
  }
  return exprs
}

/**
 * A term as JSON writes it inside a string. jsonb stores `"` and `\` escaped,
 * so the text search of `draft_data` needs the escaped form.
 */
function jsonText(term: string): string {
  return JSON.stringify(term).slice(1, -1)
}

/** The columns a search reads: an entry and its collection, as `LinkTargetRow`. */
const searchColumns = {
  id: entry.id,
  siteId: entry.siteId,
  slug: entry.slug,
  status: entry.status,
  publishedSlug: entry.publishedSlug,
  draftData: entry.draftData,
  publishedData: entry.publishedData,
  scheduledData: entry.scheduledData,
  collectionKey: collection.key,
  collectionLabel: collection.label,
  collectionKind: collection.kind,
  routePattern: collection.routePattern,
  localizedRoutes: collection.localizedRoutes,
  fields: collection.fields,
}

/**
 * The conditions every search shares: entries of the site's routed collections
 * (the enabled ones for a non-admin), not archived, plus `extra`.
 */
function routedWhere(
  siteId: string,
  enabledOnly: boolean,
  ...extra: (SQL | undefined)[]
) {
  return and(
    eq(entry.siteId, siteId),
    eq(collection.siteId, siteId),
    eq(collection.kind, 'collection'),
    ne(collection.routePattern, ''),
    enabledOnly ? eq(collection.enabled, true) : undefined,
    ne(entry.status, 'archived'),
    ...extra,
  )
}

/**
 * The entries whose title or slug contains `term` (lower case), across every
 * routed collection in one query: best matches first, then the newest. Ranks:
 * an exact title or slug, a title or slug that starts with the term, a title
 * word that starts with it, then a title or slug that contains it. Without a
 * term: the newest entries. The text of `draft_data` is only a prefilter (the
 * localized title and slug decide the match); the trigram indexes on `slug`
 * and `draft_data::text` serve it.
 */
async function searchWordRows(
  siteId: string,
  enabledOnly: boolean,
  ctx: Ctx,
  term: string,
  limit: number,
): Promise<LinkTargetRow[]> {
  const title = localizedTitleSql(ctx)
  const slug = localizedSlugSql(ctx)
  const contains = `%${escapeLike(term)}%`
  const matches = term
    ? or(
        sql`lower(${title}) LIKE ${contains}`,
        sql`lower(${slug}) LIKE ${contains}`,
      )
    : undefined
  const candidates = term
    ? or(
        sql`${entry.slug} ILIKE ${contains}`,
        sql`${entry.draftData}::text ILIKE ${`%${escapeLike(jsonText(term))}%`}`,
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
  return db
    .select({ ...searchColumns, rank })
    .from(entry)
    .innerJoin(collection, eq(entry.collectionId, collection.id))
    .where(routedWhere(siteId, enabledOnly, candidates, matches))
    .orderBy(rank, desc(entry.updatedAt), entry.slug)
    .limit(limit)
}

/**
 * The entries of every routed collection with a path that starts with `wanted`,
 * in one query. The paths are matched in SQL before the limit, in lower case.
 * Entries whose path is exactly `wanted` come first, then the newest. The
 * caller checks the paths of the rows it gets.
 */
async function searchPathRows(
  siteId: string,
  enabledOnly: boolean,
  languages: SiteLanguages | null,
  wanted: string,
  limit: number,
): Promise<LinkTargetRow[]> {
  const paths = pathExprsSql(languages)
  const prefix = sql.join(
    paths.map((path) => sql`lower(${path}) LIKE ${`${escapeLike(wanted)}%`}`),
    sql` OR `,
  )
  const exact = sql<number>`(CASE WHEN ${sql.join(
    paths.map((path) => sql`lower(${path}) = ${wanted}`),
    sql` OR `,
  )} THEN 0 ELSE 1 END)`
  return db
    .select({ ...searchColumns, rank: exact })
    .from(entry)
    .innerJoin(collection, eq(entry.collectionId, collection.id))
    .where(routedWhere(siteId, enabledOnly, sql`(${prefix})`))
    .orderBy(exact, desc(entry.updatedAt), entry.slug)
    .limit(limit)
}

/**
 * The search behind the link field. `query` is what the editor typed:
 * - empty: the newest routed entries;
 * - words: entries whose title or slug matches, in the editor's language;
 * - `/…` or an own-domain URL: entries whose path starts with it, and the
 *   entry at exactly that path (`resolved`), with its section.
 * Two queries whatever the number of collections: the site, then the entries.
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
    const rows = await searchWordRows(
      siteId,
      input.enabledOnly,
      ctx,
      parsed.text.toLowerCase(),
      input.limit,
    )
    return { ...empty, entries: rows.map((row) => optionOf(row, ctx)) }
  }

  // A path: the entry at exactly this path, and the entries whose path starts
  // with it. One more row than the list shows: the exact entry is left out.
  const wanted = safeDecode(parsed.path).toLowerCase()
  const rows = await searchPathRows(
    siteId,
    input.enabledOnly,
    siteRow.languages,
    wanted,
    input.limit + 1,
  )
  let resolved: LinkTargetSearch['resolved'] = null
  const entries: LinkTargetOption[] = []
  for (const row of rows) {
    const paths = pathsOf(row, ctx).map((path) =>
      safeDecode(path).toLowerCase(),
    )
    if (!resolved && paths.includes(wanted)) {
      resolved = { entry: optionOf(row, ctx), anchor: parsed.anchor }
      continue
    }
    if (entries.length >= input.limit) break
    if (paths.some((path) => path.startsWith(wanted))) {
      entries.push(optionOf(row, ctx))
    }
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
