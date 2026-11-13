import { inArray, and, eq } from 'drizzle-orm'

import type { DbReader } from '#/db'
import { collection, entry, site } from '#/db/schema'
import {
  I18N_KEY,
  localeStatus,
  readLocale,
  SLUG_KEY,
  servedLocales,
} from '#/lib/content-locale'
import type { LocaleCtx } from '#/lib/content-locale'
import { isDevSite } from '#/lib/site-environment'
import type { EntryData, EntryStatus, Field, SiteLanguages } from '#/lib/types'
import { isAllowedLinkHref } from '#/server/richtext/allowlist'
import {
  entryLinkTargets,
  resolveEntryLinks,
} from '#/server/richtext/entry-links'

import { ValidationError } from './errors.ts'
import { localeCtxFor } from './locale-validation.ts'

/**
 * Entry links in content: loading the entries they point at, the save check
 * that recomputes their stored `href`, and walking every rich text value of an
 * entry (the base and each `$i18n` language slot). See
 * docs/design/rich-text-links.md, decisions 6 and 7.
 */

/** What a link needs to know about its target. */
export type LinkTargetRow = {
  id: string
  siteId: string
  /** The current (draft) main-language slug. */
  slug: string
  status: EntryStatus
  /** The approved slug, when the entry has been published (see entryUiStatus). */
  publishedSlug: string | null
  collectionKey: string
  collectionLabel: string
  /** Site content sections have kind 'global' and no route. */
  collectionKind: 'collection' | 'global'
  routePattern: string
  localizedRoutes: Record<string, string> | null
  fields: Field[]
  draftData: EntryData
  publishedData: EntryData | null
  scheduledData: EntryData | null
}

/**
 * The sites a link in `siteId` may point at: the site itself, and for a
 * development environment its production site (the one it was forked from, in
 * the same organization). A link to production keeps the production id, which
 * is why a push passes it through (docs/design/dev-environments.md).
 */
export async function linkTargetSiteIds(
  connection: DbReader,
  siteId: string,
): Promise<string[]> {
  const row = (
    await connection
      .select({
        environment: site.environment,
        organizationId: site.organizationId,
        parentSiteId: site.parentSiteId,
      })
      .from(site)
      .where(eq(site.id, siteId))
      .limit(1)
  ).at(0)
  if (!row || !isDevSite(row) || !row.parentSiteId) return [siteId]
  const production = (
    await connection
      .select({ id: site.id })
      .from(site)
      .where(
        and(
          eq(site.id, row.parentSiteId),
          eq(site.organizationId, row.organizationId),
        ),
      )
      .limit(1)
  ).at(0)
  return production ? [siteId, production.id] : [siteId]
}

/**
 * Target rows for the given ids, from the sites (see `linkTargetSiteIds`).
 * Missing ids are absent from the map.
 */
export async function loadLinkTargets(
  connection: DbReader,
  siteIds: string | string[],
  ids: Iterable<string>,
): Promise<Map<string, LinkTargetRow>> {
  const list = [...new Set(ids)]
  const sites = typeof siteIds === 'string' ? [siteIds] : siteIds
  const out = new Map<string, LinkTargetRow>()
  if (list.length === 0) return out
  const rows = await connection
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
    .where(and(inArray(entry.siteId, sites), inArray(entry.id, list)))
  for (const row of rows) out.set(row.id, row)
  return out
}

/** The path an entry link points at: the route with the slug, and the section. */
export function entryLinkPath(
  routePattern: string,
  slug: string,
  anchor: string | null,
): string {
  const path = routePattern.split('$slug').join(encodeURIComponent(slug))
  return anchor ? `${path}#${anchor}` : path
}

/**
 * Languages an entry ships in: the complete ones, in site order. A language
 * with nothing filled in does not ship even when it has no required fields
 * (sections without required fields are complete in every language). The
 * main language always ships when it is complete.
 */
export function shippedLocales(data: EntryData, ctx: LocaleCtx): string[] {
  return servedLocales(data, ctx).filter(
    (locale) => locale === ctx.main || localeStatus(data, locale, ctx).started,
  )
}

/**
 * Where a link to an entry points in `locale`: the language the target's path
 * is taken from, with that language's view, route and slug. The language is
 * `locale` when its translation ships in `data` (the release rule), else the
 * main language. Go live and draft previews both place links with this, so a
 * link resolves the same way in both. `language` is null on a single-language
 * site.
 */
export function placeLinkTarget(
  target: {
    data: EntryData
    fields: Field[]
    slug: string
    routePattern: string
    localizedRoutes?: Record<string, string> | null
  },
  languages: SiteLanguages | null,
  locale: string | null,
): {
  view: EntryData
  route: string
  slug: string
  language: string | null
} {
  const main = languages?.main ?? null
  const ctx = languages ? localeCtxFor(languages, target.fields) : null
  const wantsTranslation = Boolean(ctx && locale && locale !== main)
  if (
    !ctx ||
    !locale ||
    !wantsTranslation ||
    !shippedLocales(target.data, ctx).includes(locale)
  ) {
    return {
      view: target.data,
      route: target.routePattern,
      slug: target.slug,
      language: main,
    }
  }
  const view = readLocale(target.data, locale, ctx)
  const localSlug = view[SLUG_KEY]
  return {
    view,
    route: target.localizedRoutes?.[locale] ?? target.routePattern,
    slug:
      typeof localSlug === 'string' && localSlug !== ''
        ? localSlug
        : target.slug,
    language: locale,
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export type RichTextSlot = {
  /** The language the value is written in. Null for the base slot. */
  locale: string | null
  field: string
}

/**
 * Every rich text value of an entry, with the slot it sits in. `visit` may
 * return a replacement. The result is a copy; `data` is not mutated.
 */
export async function mapRichTextValues(
  data: EntryData,
  fields: Field[],
  visit: (json: unknown, slot: RichTextSlot) => Promise<unknown> | unknown,
): Promise<EntryData> {
  const keys = fields
    .filter((field) => field.type === 'richtext')
    .map((field) => field.key)
  if (keys.length === 0) return data
  const next: EntryData = { ...data }
  for (const key of keys) {
    if (isPlainObject(data[key])) {
      next[key] = await visit(data[key], { locale: null, field: key })
    }
  }
  const translations = data[I18N_KEY]
  if (isPlainObject(translations)) {
    const nextTranslations: Record<string, unknown> = { ...translations }
    for (const [locale, slot] of Object.entries(translations)) {
      if (!isPlainObject(slot)) continue
      const copy: Record<string, unknown> = { ...slot }
      for (const key of keys) {
        if (isPlainObject(slot[key])) {
          copy[key] = await visit(slot[key], { locale, field: key })
        }
      }
      nextTranslations[locale] = copy
    }
    next[I18N_KEY] = nextTranslations
  }
  return next
}

/**
 * The save check. Every entry link must point at an entry of this site in a
 * collection with a page. Its stored collection and `href` are recomputed from
 * the target: the href is the target's main-language path plus the section.
 * Throws a validation error that names each bad link.
 */
export async function prepareEntryLinks(
  connection: DbReader,
  siteId: string,
  fields: Field[],
  data: EntryData,
): Promise<EntryData> {
  const ids = new Set<string>()
  await mapRichTextValues(data, fields, (json) => {
    for (const target of entryLinkTargets(json)) ids.add(target.entryId)
    return json
  })
  if (ids.size === 0) return data

  const siteIds = await linkTargetSiteIds(connection, siteId)
  const targets = await loadLinkTargets(connection, siteIds, ids)
  const errors: { path: string; message: string }[] = []
  for (const id of ids) {
    const target = targets.get(id)
    if (!target) {
      errors.push({
        path: '',
        message: `A link points at entry ${id}, which is not in this site.`,
      })
    } else if (
      target.collectionKind === 'global' ||
      target.routePattern === ''
    ) {
      errors.push({
        path: '',
        message: `A link points at "${target.slug}", which has no page. Only entries of collections with a page can be linked.`,
      })
    }
  }
  if (errors.length > 0) throw new ValidationError(errors)

  return mapRichTextValues(data, fields, async (json, slot) => {
    const resolved = await resolveEntryLinks(json, async (target) => {
      const row = targets.get(target.entryId)!
      const href = entryLinkPath(row.routePattern, row.slug, target.anchor)
      if (!isAllowedLinkHref(href)) {
        throw new ValidationError([
          {
            path: slot.field,
            message: `The link to "${row.slug}" cannot be saved.`,
          },
        ])
      }
      return {
        href,
        targetTitle: row.slug,
        collection: row.collectionKey,
      }
    })
    return resolved.json
  })
}
