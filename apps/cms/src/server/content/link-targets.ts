import { and, desc, eq, ilike, ne, or, sql } from 'drizzle-orm'
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

/** Most candidate rows a search reads before it ranks them. */
const CANDIDATE_LIMIT = 300

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
 * site's own host is a path too; any other URL is not an entry. Everything
 * else is words to search for.
 */
export function parseLinkQuery(query: string, hosts: Set<string>): ParsedQuery {
  const text = query.trim()
  if (text.startsWith('/') && !text.startsWith('//')) {
    const hash = text.indexOf('#')
    const path = hash === -1 ? text : text.slice(0, hash)
    const anchor = hash === -1 ? null : text.slice(hash + 1) || null
    return { kind: 'path', path, anchor, ownPath: null }
  }
  if (/^https?:\/\//i.test(text)) {
    let url: URL | null = null
    try {
      url = new URL(text)
    } catch {
      url = null
    }
    if (url && hosts.has(url.host.toLowerCase())) {
      const anchor = url.hash ? url.hash.slice(1) || null : null
      return {
        kind: 'path',
        path: url.pathname,
        anchor,
        ownPath: `${url.pathname}${url.search}${url.hash}`,
      }
    }
    return { kind: 'external' }
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
 * The option for one entry in the editor's language. The title and slug are
 * the translation's when it has them, else the main language's. The path
 * follows the release rule (`placeLinkTarget`), so it is where the link goes.
 */
function optionOf(row: LinkTargetRow, ctx: Ctx): LinkTargetOption {
  const { languages, locale } = ctx
  const lctx = languages ? localeCtxFor(languages, row.fields) : null
  const wanted =
    lctx && locale && languages && locale !== languages.main
      ? readLocale(row.draftData, locale, lctx)
      : row.draftData
  const localSlug = wanted[SLUG_KEY]
  const slug =
    typeof localSlug === 'string' && localSlug !== '' ? localSlug : row.slug
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
    title:
      titleIn(wanted, row.fields) ??
      titleIn(row.draftData, row.fields) ??
      row.slug,
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

/**
 * Routed entries of the site that are not archived, newest first. A search
 * term is matched on the stored text as a first filter; the caller ranks the
 * rows by the title and slug in the editor's language.
 */
async function candidateRows(
  siteId: string,
  options: { enabledOnly: boolean; term: string | null; limit: number },
): Promise<LinkTargetRow[]> {
  const pattern = options.term ? `%${escapeLike(options.term)}%` : null
  const rows = await db
    .select({
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
    })
    .from(entry)
    .innerJoin(collection, eq(entry.collectionId, collection.id))
    .where(
      and(
        eq(entry.siteId, siteId),
        eq(collection.kind, 'collection'),
        ne(collection.routePattern, ''),
        ne(entry.status, 'archived'),
        options.enabledOnly ? eq(collection.enabled, true) : undefined,
        pattern
          ? or(
              ilike(entry.slug, pattern),
              ilike(sql`${entry.draftData}::text`, pattern),
            )
          : undefined,
      ),
    )
    .orderBy(desc(entry.updatedAt), entry.slug)
    .limit(options.limit)
  return rows
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
 * A text of the entry as the editor's option shows it (`optionOf`): the
 * language's value, else the base language's. In SQL, so the search can match
 * and rank on it before the limit.
 */
function localizedTextSql(key: string, ctx: Ctx): SQL<string | null> {
  const data = entry.draftData
  const base = ctx.languages?.main ?? null
  if (!ctx.locale || !ctx.languages) return sql`(${data} ->> ${key})`
  const locale = ctx.locale
  return sql`(CASE WHEN coalesce(${data} ->> ${LOCALE_KEY}, ${base}) = ${locale}
    THEN ${data} ->> ${key}
    ELSE coalesce(nullif(${data} #>> ARRAY[${I18N_KEY}, ${locale}, ${key}]::text[], ''), ${data} ->> ${key}) END)`
}

/** The slug as the editor's option shows it (`optionOf`), in SQL. */
function localizedSlugSql(ctx: Ctx): SQL<string | null> {
  const data = entry.draftData
  const base = ctx.languages?.main ?? null
  if (!ctx.locale || !ctx.languages) {
    return sql`coalesce(nullif(${data} ->> ${SLUG_KEY}, ''), ${entry.slug})`
  }
  const locale = ctx.locale
  return sql`(CASE WHEN coalesce(${data} ->> ${LOCALE_KEY}, ${base}) = ${locale}
    THEN coalesce(nullif(${data} ->> ${SLUG_KEY}, ''), ${entry.slug})
    ELSE coalesce(nullif(${data} #>> ARRAY[${I18N_KEY}, ${locale}, ${SLUG_KEY}]::text[], ''), ${entry.slug}) END)`
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
  const titleKey = firstTextField(target.fields)?.key
  const title = titleKey
    ? localizedTextSql(titleKey, ctx)
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
    .select({
      id: entry.id,
      siteId: entry.siteId,
      slug: entry.slug,
      status: entry.status,
      publishedSlug: entry.publishedSlug,
      draftData: entry.draftData,
      publishedData: entry.publishedData,
      scheduledData: entry.scheduledData,
      updatedAt: entry.updatedAt,
      rank,
    })
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
  return rows.map(
    ({
      updatedAt,
      rank: hitRank,
      ...row
    }): LinkTargetRow & {
      updatedAt: Date
      rank: number
    } => ({
      ...row,
      collectionKey: target.key,
      collectionLabel: target.label,
      collectionKind: 'collection',
      routePattern: target.routePattern,
      localizedRoutes: target.localizedRoutes,
      fields: target.fields,
      updatedAt,
      rank: hitRank,
    }),
  )
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

  // A path: the entry at exactly this path, and the entries it starts.
  const wanted = safeDecode(parsed.path).toLowerCase()
  const lastSegment = parsed.path.slice(parsed.path.lastIndexOf('/') + 1)
  const term = lastSegment ? safeDecode(lastSegment) : null
  const rows = await candidateRows(siteId, {
    enabledOnly: input.enabledOnly,
    term,
    limit: CANDIDATE_LIMIT,
  })
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
    if (
      entries.length < input.limit &&
      paths.some((path) => path.startsWith(wanted))
    ) {
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
