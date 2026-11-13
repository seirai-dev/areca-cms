import { and, eq, inArray } from 'drizzle-orm'

import { db } from '#/db'
import { collection, entry } from '#/db/schema'
import { localeStatus } from '#/lib/content-locale'
import type {
  EntryData,
  Field,
  ReferenceValue,
  SeoMeta,
  SiteLanguages,
  SnapshotEntry,
  SnapshotGlobal,
} from '#/lib/types'
import { loadAssetLookup } from '#/server/assets'
import type { AssetLookup } from '#/server/assets'
import { entryTitle } from '#/lib/content/utils'

import { getCollection } from './collections.ts'
import { getGlobalEntry } from './globals.ts'
import { localeCtxFor } from './locale-validation.ts'
import {
  entryLinkIdsOf,
  entryLinkPath,
  linkTargetSiteIds,
  loadLinkTargets,
  placeLinkTarget,
} from './entry-links.ts'
import type { LinkTargetRow } from './entry-links.ts'
import {
  collectAssetRefs,
  expandAcrossLanguages,
  expandEntryView,
  expandSectionView,
  languageViews,
  localeFields,
} from './snapshot-expand.ts'
import type {
  AssetRefs,
  ExpandContext,
  LinkResolver,
} from './snapshot-expand.ts'
import { findSite } from './site-core.ts'
import type { SiteCore } from './site-core.ts'

export type PreviewLocaleStatus = { complete: boolean; missing: string[] }

/**
 * Draft preview of an entry. `locales` has the snapshot shape (shipped
 * languages only); `localeStatus` lists every site language.
 */
export type PreviewEntry = Omit<SnapshotEntry, 'locales'> & {
  isFallback?: boolean
  locales?: Record<
    string,
    { slug: string; data: Record<string, unknown>; seo?: SeoMeta }
  >
  localeStatus?: Record<string, PreviewLocaleStatus>
}

/** Draft preview of a site content section. Same rules as `PreviewEntry`. */
export type PreviewGlobal = Omit<SnapshotGlobal, 'locales'> & {
  isFallback?: boolean
  locales?: Record<string, { data: Record<string, unknown>; seo?: SeoMeta }>
  localeStatus?: Record<string, PreviewLocaleStatus>
}

type PreviewCollection = NonNullable<Awaited<ReturnType<typeof getCollection>>>
type PreviewGlobalRow = NonNullable<
  Awaited<ReturnType<typeof getGlobalEntry>>
>['global']

/**
 * Draft preview of one section (`data` is the draft, not the ready version).
 * `locale` picks the language, with the snapshot's fallback chain.
 */
export async function buildPreviewGlobal(
  siteId: string,
  key: string,
  locale?: string | null,
): Promise<PreviewGlobal | null> {
  const found = await getGlobalEntry(siteId, key)
  const previewSite = await findSite(siteId)
  if (!found || !previewSite) return null
  return buildPreviewGlobalFromDraft({
    site: previewSite,
    global: found.global,
    entryRow: found.entry,
    draftData: found.entry.draftData,
    locale,
  })
}

/**
 * `buildPreviewGlobal` for a draft the caller supplies (the live preview's
 * unsaved values). Reads nothing and writes nothing; `entryRow` only supplies
 * the section entry's id and publish date. Null when the section is disabled.
 */
export async function buildPreviewGlobalFromDraft(input: {
  site: SiteCore
  global: PreviewGlobalRow
  entryRow: { id: string; publishedAt: Date | null }
  draftData: EntryData
  locale?: string | null
}): Promise<PreviewGlobal | null> {
  const { site: previewSite, global, entryRow: row, draftData } = input
  if (!global.enabled) return null
  const ctx = await previewContext(previewSite, global.fields, draftData)
  const expanded = expandAcrossLanguages(
    ctx.languages,
    global.fields,
    draftData,
    (view, locale) => expandSectionView(ctx, global, row, view, locale),
    input.locale ?? null,
  )
  return {
    id: row.id,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    data: expanded.top.data,
    ...(expanded.top.seo ? { seo: expanded.top.seo } : {}),
    ...localeFields(expanded),
    ...previewLanguageFields(expanded, ctx.languages, global.fields, draftData),
  }
}

/**
 * Draft preview of one entry. `locale` picks the language, with the snapshot's
 * fallback chain; without it the main language is returned.
 */
export async function buildPreviewEntry(
  siteId: string,
  collectionKey: string,
  slug: string,
  locale?: string | null,
): Promise<PreviewEntry | null> {
  const col = await getCollection(siteId, collectionKey)
  const previewSite = await findSite(siteId)
  if (!col || !previewSite) return null

  const row = (
    await db
      .select()
      .from(entry)
      .where(and(eq(entry.collectionId, col.id), eq(entry.slug, slug)))
      .limit(1)
  ).at(0)
  if (!row) return null
  return buildPreviewEntryFromDraft({
    site: previewSite,
    collection: col,
    entryRow: row,
    draftData: row.draftData,
    locale,
  })
}

/**
 * `buildPreviewEntry` for a draft the caller supplies (the live preview's
 * unsaved values). Reads nothing and writes nothing. `entryRow` gives the
 * entry's id, the slug to show (the caller decides it, e.g. an unsaved slug)
 * and its publish date.
 */
export async function buildPreviewEntryFromDraft(input: {
  site: SiteCore
  collection: PreviewCollection
  entryRow: { id: string; slug: string; publishedAt: Date | null }
  draftData: EntryData
  locale?: string | null
}): Promise<PreviewEntry> {
  const { site: previewSite, collection: col, entryRow: row, draftData } = input
  const ctx = await previewContext(previewSite, col.fields, draftData)
  const item = {
    id: row.id,
    collectionKey: col.key,
    fields: col.fields,
    slug: row.slug,
    routePattern: col.routePattern,
    localizedRoutes: col.localizedRoutes,
    publishedAt: row.publishedAt,
  }
  const expanded = expandAcrossLanguages(
    ctx.languages,
    col.fields,
    draftData,
    (view, locale) => expandEntryView(ctx, item, view, locale),
    input.locale ?? null,
  )
  return {
    id: row.id,
    slug: expanded.top.slug,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    data: expanded.top.data,
    seo: expanded.top.seo,
    ...localeFields(expanded),
    ...previewLanguageFields(expanded, ctx.languages, col.fields, draftData),
  }
}

/**
 * The expand context of a draft preview. Its assets, reference targets and
 * entry link targets, in every language, are read once up front. A missing
 * asset or reference shows as null.
 */
async function previewContext(
  previewSite: SiteCore,
  fields: Field[],
  draftData: EntryData,
): Promise<ExpandContext> {
  const languages = previewSite.languages ?? null
  const [{ assets, references }, linkTargets] = await Promise.all([
    loadPreviewLookups(previewSite, fields, draftData),
    loadLinkTargets(
      db,
      await linkTargetSiteIds(db, previewSite.id),
      entryLinkIdsOf([draftData], fields),
    ),
  ])
  const links = draftLinkResolver(linkTargets, languages)
  return {
    site: previewSite,
    languages,
    assets,
    strict: false,
    reference(id, field) {
      const ref = field.collection ? references.get(id) : undefined
      return ref && ref.collection === field.collection ? ref : null
    },
    links: () => links,
  }
}

/**
 * Draft previews: an entry link goes to the target's current draft path in the
 * language of the text, live or not, so clicking through the preview works.
 * A target that no longer exists becomes plain text.
 */
function draftLinkResolver(
  targets: Map<string, LinkTargetRow>,
  languages: SiteLanguages | null,
): LinkResolver {
  return {
    resolve(target, locale) {
      const row = targets.get(target.entryId)
      if (!row || row.collectionKind === 'global' || row.routePattern === '') {
        return { href: null, reason: 'missing', targetTitle: '' }
      }
      const placed = placeLinkTarget(
        { ...row, data: row.draftData },
        languages,
        locale,
      )
      return {
        href: entryLinkPath(placed.route, placed.slug, target.anchor),
        targetTitle: entryTitle(placed.view, row.fields, placed.slug),
        locale: placed.language,
      }
    },
    report() {},
  }
}

/** `isFallback` and `localeStatus` for a language site; nothing otherwise. */
function previewLanguageFields(
  expanded: { locale?: string; isFallback?: boolean },
  languages: SiteLanguages | null,
  fields: Field[],
  draft: EntryData,
): {
  isFallback?: boolean
  localeStatus?: Record<string, PreviewLocaleStatus>
} {
  if (!languages || expanded.locale === undefined) return {}
  const ctx = localeCtxFor(languages, fields)
  return {
    isFallback: expanded.isFallback ?? false,
    localeStatus: Object.fromEntries(
      languages.all.map((locale) => {
        const status = localeStatus(draft, locale, ctx)
        return [locale, { complete: status.complete, missing: status.missing }]
      }),
    ),
  }
}

/**
 * The assets and reference targets a draft preview uses, in every language,
 * read once instead of one query per image and per reference.
 */
async function loadPreviewLookups(
  previewSite: SiteCore,
  fields: Field[],
  draftData: EntryData,
): Promise<{ assets: AssetLookup; references: Map<string, ReferenceValue> }> {
  const views = languageViews(previewSite.languages ?? null, fields, draftData)
  const assetRefs: AssetRefs = { ids: new Set(), storageKeys: new Set() }
  collectAssetRefs(fields, views, assetRefs)

  const referenceIds = new Set<string>()
  for (const view of views) {
    for (const field of fields) {
      const value = view[field.key]
      if (
        field.type === 'reference' &&
        field.collection &&
        typeof value === 'string' &&
        value !== ''
      ) {
        referenceIds.add(value)
      }
    }
  }

  const [assets, referenceRows] = await Promise.all([
    loadAssetLookup(previewSite.organizationId, assetRefs),
    referenceIds.size === 0
      ? []
      : db
          .select({
            id: entry.id,
            slug: entry.slug,
            collectionKey: collection.key,
          })
          .from(entry)
          .innerJoin(collection, eq(entry.collectionId, collection.id))
          .where(
            and(
              inArray(entry.id, [...referenceIds]),
              eq(entry.siteId, previewSite.id),
            ),
          ),
  ])
  const references = new Map<string, ReferenceValue>()
  for (const row of referenceRows) {
    references.set(row.id, {
      collection: row.collectionKey,
      slug: row.slug,
      id: row.id,
    })
  }
  return { assets, references }
}
