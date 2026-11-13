import {
  richTextAssetRefs,
  richTextAssetsAuthorized,
  richTextAssetsAuthorizedFrom,
} from '#/server/assets/richtext-ownership'
import { createHash } from 'node:crypto'
import { and, eq, inArray, or } from 'drizzle-orm'

import { db } from '#/db'
import type { DbReader } from '#/db'
import { collection, entry, site } from '#/db/schema'
import {
  GLOBAL_ENTRY_SLUG,
  globalPublicUrl,
  globalsAsEntryLists,
} from '#/lib/globals'
import {
  SLUG_KEY,
  localeStatus,
  normalizeBase,
  readLocale,
  resolveChain,
} from '#/lib/content-locale'
import { entryPublicUrl, readEntrySeo, withoutSeo } from '#/lib/seo'
import type {
  EntryData,
  Field,
  GlobalConfig,
  ImageValue,
  ReferenceValue,
  SeoMeta,
  SiteLanguages,
  Snapshot,
  SnapshotEntry,
  SnapshotGlobal,
} from '#/lib/types'
import { m } from '#/paraglide/messages'
import {
  loadAssetLookup,
  resolveAssetFromLookup,
  resolveAssetValue,
} from '#/server/assets'
import type { AssetLookup } from '#/server/assets'
import { snapshotAssets } from '#/server/assets/published-assets'
import { convertRichText, validateRichText } from '#/server/richtext'
import {
  entryLinkTargets,
  resolveEntryLinks,
  richTextHeadingIds,
} from '#/server/richtext/entry-links'
import type {
  EntryLinkIssue,
  EntryLinkResolution,
  EntryLinkTarget,
} from '#/server/richtext/entry-links'
import { entryTitle } from '#/lib/content/utils'
import { stableStringify } from '#/lib/stable-json'

import { getCollection, listCollections } from './collections.ts'
import { getGlobalEntry, listGlobals } from './globals.ts'
import { NotFoundError, ValidationError } from './errors.ts'
import {
  formatLanguageBlockers,
  languageBlockers,
  localeCtxFor,
} from './locale-validation.ts'
import {
  entryLinkPath,
  placeLinkTarget,
  shippedLocales,
  linkTargetSiteIds,
  loadLinkTargets,
  mapRichTextValues,
} from './entry-links.ts'
import type { LinkTargetRow } from './entry-links.ts'
import { buildEntrySeo } from './seo.ts'
import { buildSnapshotSchema } from './snapshot-schema.ts'
import { pickDeclaredFields, validateEntryData } from './validation.ts'
import { siteCoreColumns } from './site-core.ts'
import type { SiteCore } from './site-core.ts'

type IncludedEntry = {
  collectionKey: string
  routePattern: string
  /** Per-language route patterns. Collections only. */
  localizedRoutes?: Record<string, string> | null
  /** Languages besides main that must be complete. */
  requiredLanguages?: string[]
  fields: Field[]
  row: typeof entry.$inferSelect
  data: EntryData
  slug: string
  publishedAt: Date | null
}

export type SnapshotOptions = {
  /**
   * Release diff only. A section with required fields that was never marked
   * ready is left out of the candidate instead of failing the build, so the
   * ready changes still list while the site is blocked. Go live keeps the
   * default and refuses.
   */
  allowNeverReadySections?: boolean
}

/**
 * A link that will not work on the live site, or points at a section that is
 * gone. It never blocks a release: the link is published as plain text
 * (`not-live`, `missing`) or to the page (`missing-section`).
 */
export type LinkWarning = {
  sourceEntryId: string
  sourceTitle: string
  /** The source's collection key, or the section key for a site content section. */
  sourceCollectionKey: string
  /** True when the source is a site content section (it has no collection page). */
  sourceGlobal: boolean
  /** Language of the text. Null on a single-language site. */
  locale: string | null
  field: string
  targetEntryId: string
  targetTitle: string
  anchor: string | null
  reason: 'not-live' | 'missing' | 'missing-section'
}

/** Resolves the entry links of one rich text view, and collects their problems. */
export type LinkResolver = {
  resolve: (
    target: EntryLinkTarget,
    locale: string | null,
  ) => Promise<EntryLinkResolution>
  report: (
    field: string,
    locale: string | null,
    issues: EntryLinkIssue[],
  ) => void
}

export async function buildSnapshot(
  siteId: string,
  connection: DbReader = db,
  options: SnapshotOptions = {},
): Promise<
  | {
      ok: true
      snapshot: Snapshot
      hash: string
      entryVersions: { entryId: string; scheduledVersion: string }[]
      linkWarnings: LinkWarning[]
    }
  | { ok: false; errors: string[] }
> {
  const existingSite = (
    await connection
      .select(siteCoreColumns)
      .from(site)
      .where(eq(site.id, siteId))
      .limit(1)
  ).at(0)
  if (!existingSite) {
    throw new NotFoundError(m.server_site_not_found())
  }

  const siteRow = existingSite
  const now = new Date()
  // Null on a single-language site: every language step below is skipped.
  const languages: SiteLanguages | null = existingSite.languages ?? null
  const enabled = await listCollections(
    siteId,
    { enabledOnly: true },
    connection,
  )
  const errors: string[] = []
  const entryVersions: { entryId: string; scheduledVersion: string }[] = []
  const included: IncludedEntry[] = []

  for (const col of enabled) {
    const rows = await connection
      .select()
      .from(entry)
      .where(
        and(
          eq(entry.siteId, siteId),
          eq(entry.collectionId, col.id),
          or(eq(entry.status, 'published'), eq(entry.status, 'scheduled')),
        ),
      )

    for (const row of rows) {
      const isScheduledDue =
        row.status === 'scheduled' &&
        row.scheduledAt != null &&
        row.scheduledAt <= now
      const data = isScheduledDue ? row.scheduledData : row.publishedData
      const slug = isScheduledDue ? row.scheduledSlug : row.publishedSlug
      if (!isScheduledDue && row.status === 'scheduled' && !data) continue
      if (!slug) {
        errors.push(`${col.key}/${row.id}: missing approved slug`)
        continue
      }
      if (isScheduledDue && !row.scheduledVersion) {
        errors.push(`${col.key}/${row.id}: missing scheduled version`)
        continue
      }
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
      if (isScheduledDue)
        entryVersions.push({
          entryId: row.id,
          scheduledVersion: row.scheduledVersion!,
        })
      const normalized = languages
        ? normalizeBase(parsed.data, localeCtxFor(languages, col.fields))
        : parsed.data
      if (languages) {
        const gaps = languageBlockers({
          data: normalized,
          fields: col.fields,
          languages,
          requiredLanguages: col.requiredLanguages,
        })
        if (gaps.length > 0) {
          errors.push(`${col.key}/${row.slug}: ${formatLanguageBlockers(gaps)}`)
        }
      }
      included.push({
        slug,
        collectionKey: col.key,
        routePattern: col.routePattern,
        localizedRoutes: col.localizedRoutes,
        requiredLanguages: col.requiredLanguages,
        fields: col.fields,
        row,
        data: normalized,
        publishedAt: isScheduledDue ? row.scheduledAt : row.publishedAt,
      })
    }
  }

  // Site content sections: one `$global` entry each. A section with no ready
  // data blocks go live only when it has required fields; otherwise it ships `{}`.
  const sections = await listGlobals(siteId, { enabledOnly: true }, connection)
  const sectionItems = new Map<string, IncludedEntry>()
  const unreadySections = new Map<string, string>()
  for (const section of sections) {
    const row = (
      await connection
        .select()
        .from(entry)
        .where(
          and(
            eq(entry.siteId, siteId),
            eq(entry.collectionId, section.id),
            eq(entry.slug, GLOBAL_ENTRY_SLUG),
          ),
        )
        .limit(1)
    ).at(0)
    if (!row) {
      errors.push(`Site content "${section.label}": entry is missing`)
      continue
    }
    const isScheduledDue =
      row.status === 'scheduled' &&
      row.scheduledAt != null &&
      row.scheduledAt <= now
    const data =
      row.status === 'draft'
        ? null
        : isScheduledDue
          ? row.scheduledData
          : row.publishedData
    if (data == null) {
      if (section.fields.some((field) => field.required)) {
        if (!options.allowNeverReadySections) {
          errors.push(
            `Site content "${section.label}" has required fields and has never been marked ready.`,
          )
        }
      } else {
        unreadySections.set(section.key, row.id)
      }
      continue
    }
    if (isScheduledDue) {
      if (!row.scheduledVersion) {
        errors.push(`${section.key}: missing scheduled version`)
        continue
      }
      entryVersions.push({
        entryId: row.id,
        scheduledVersion: row.scheduledVersion,
      })
    }
    const parsed = validateEntryData(section.fields, data)
    if (!parsed.ok) {
      for (const err of parsed.errors) {
        errors.push(
          `Site content "${section.label}": ${err.path ? `${err.path}: ` : ''}${err.message}`,
        )
      }
      continue
    }
    const sectionData = languages
      ? normalizeBase(parsed.data, localeCtxFor(languages, section.fields))
      : parsed.data
    if (languages) {
      const gaps = languageBlockers({
        data: sectionData,
        fields: section.fields,
        languages,
        requiredLanguages: section.requiredLanguages,
      })
      if (gaps.length > 0) {
        errors.push(
          `Site content "${section.label}": ${formatLanguageBlockers(gaps)}`,
        )
      }
    }
    sectionItems.set(section.key, {
      collectionKey: section.key,
      routePattern: '',
      requiredLanguages: section.requiredLanguages,
      fields: section.fields,
      row,
      data: sectionData,
      slug: GLOBAL_ENTRY_SLUG,
      publishedAt: isScheduledDue ? row.scheduledAt : row.publishedAt,
    })
  }
  // Sections take part in reference and asset checks like any entry.
  const everything = [...included, ...sectionItems.values()]

  const slugsByCollection = new Map<string, Set<string>>()
  for (const item of included) {
    let slugs = slugsByCollection.get(item.collectionKey)
    if (!slugs) {
      slugs = new Set()
      slugsByCollection.set(item.collectionKey, slugs)
    }
    if (slugs.has(item.slug)) {
      errors.push(`${item.collectionKey}: duplicate slug "${item.slug}"`)
    }
    slugs.add(item.slug)
  }

  const entriesByUrl = new Map<string, IncludedEntry>()
  for (const item of included) {
    const url = entryPublicUrl(
      existingSite.productionUrl,
      item.routePattern,
      item.slug,
    )
    if (!url) continue
    const owner = entriesByUrl.get(url)
    if (owner) {
      errors.push(
        `Route collision: two pages use the same URL ${url}: "${owner.collectionKey}/${owner.slug}" and "${item.collectionKey}/${item.slug}". Change a page slug or content type route before publishing.`,
      )
    }
    entriesByUrl.set(url, item)
  }

  const includedById = new Map<string, IncludedEntry>()
  for (const item of everything) {
    includedById.set(item.row.id, item)
  }

  // Every language view of an item is checked: a translation may point at an
  // asset or entry the snapshot must still resolve. Single-language: the base.
  const scopesOf = (item: IncludedEntry): EntryData[] =>
    languages
      ? languages.all.map((locale) =>
          readLocale(item.data, locale, localeCtxFor(languages, item.fields)),
        )
      : [item.data]

  // One batched lookup replaces a query per embedded/linked asset.
  const assetRefs: AssetRefs = { ids: new Set(), storageKeys: new Set() }
  for (const item of everything) {
    collectAssetRefs(item.fields, scopesOf(item), assetRefs)
  }
  const assets = await loadAssetLookup(
    existingSite.organizationId,
    assetRefs,
    connection,
  )

  // Entry links: every target any language view points at, looked up once.
  // Targets that are not in the release are read here too, to tell apart a
  // draft from an entry that does not exist.
  const linkTargetIds = new Set<string>()
  for (const item of everything) {
    for (const scope of scopesOf(item)) {
      for (const field of item.fields) {
        if (field.type !== 'richtext') continue
        for (const target of entryLinkTargets(scope[field.key])) {
          linkTargetIds.add(target.entryId)
        }
      }
    }
  }
  const linkTargets = await loadLinkTargets(
    connection,
    await linkTargetSiteIds(connection, siteId),
    linkTargetIds,
  )

  for (const item of everything) {
    for (const scope of scopesOf(item)) {
      for (const field of item.fields) {
        if (field.type !== 'reference') continue
        const value = scope[field.key]
        if (value == null || value === '') continue
        if (typeof value !== 'string') {
          errors.push(
            `${item.collectionKey}/${item.slug}: ${field.key}: expected an entry id`,
          )
          continue
        }
        const target = includedById.get(value)
        if (!target) {
          errors.push(
            `${item.collectionKey}/${item.slug}: ${field.key}: referenced entry is not in the snapshot`,
          )
          continue
        }
        if (field.collection && target.collectionKey !== field.collection) {
          errors.push(
            `${item.collectionKey}/${item.slug}: ${field.key}: referenced entry is not in "${field.collection}"`,
          )
        }
      }

      for (const field of item.fields) {
        if (
          field.type === 'richtext' &&
          !richTextAssetsAuthorizedFrom(scope[field.key], assets)
        ) {
          errors.push(
            `${item.collectionKey}/${item.slug}: ${field.key}: embedded asset not found in this organization`,
          )
        }
        if (field.type !== 'image') continue
        const value = scope[field.key]
        if (value == null || value === '') continue
        if (typeof value !== 'string') {
          errors.push(
            `${item.collectionKey}/${item.slug}: ${field.key}: expected an asset id`,
          )
          continue
        }
        if (!resolveAssetFromLookup(assets, value)) {
          errors.push(
            `${item.collectionKey}/${item.slug}: ${field.key}: asset not found`,
          )
        }
      }
    }
  }

  if (errors.length > 0) {
    // Language views share their shared fields, so one problem can repeat.
    return { ok: false, errors: languages ? [...new Set(errors)] : errors }
  }

  const linkWarnings = new Map<string, LinkWarning>()
  const headingCache = new Map<string, Set<string>>()
  /**
   * The view a target shows in `locale`: its translation when that language
   * ships, else the main language (the fallback chain). `language` is the
   * language the view is in.
   */
  function linkTargetView(item: IncludedEntry, locale: string | null) {
    return placeLinkTarget(item, languages, locale)
  }
  function headingIdsOf(
    item: IncludedEntry,
    language: string | null,
  ): Set<string> {
    const key = `${item.row.id}|${language ?? ''}`
    const cached = headingCache.get(key)
    if (cached) return cached
    const shown =
      languages && language && language !== languages.main
        ? readLocale(item.data, language, localeCtxFor(languages, item.fields))
        : item.data
    const ids = new Set<string>()
    for (const field of item.fields) {
      if (field.type !== 'richtext') continue
      for (const id of richTextHeadingIds(shown[field.key])) ids.add(id)
    }
    headingCache.set(key, ids)
    return ids
  }
  /** Resolves a link to the release: a live entry's path in that language, or why it cannot work. */
  async function resolveSnapshotLink(
    target: EntryLinkTarget,
    locale: string | null,
  ): Promise<EntryLinkResolution> {
    const live = includedById.get(target.entryId)
    if (live && live.routePattern !== '') {
      const placed = linkTargetView(live, locale)
      const targetTitle = entryTitle(placed.view, live.fields, placed.slug)
      if (!target.anchor) {
        return {
          href: entryLinkPath(placed.route, placed.slug, null),
          targetTitle,
          locale: placed.language,
        }
      }
      if (headingIdsOf(live, placed.language).has(target.anchor)) {
        return {
          href: entryLinkPath(placed.route, placed.slug, target.anchor),
          targetTitle,
          locale: placed.language,
        }
      }
      return {
        href: entryLinkPath(placed.route, placed.slug, null),
        reason: 'missing-section',
        targetTitle,
        locale: placed.language,
      }
    }
    const row = linkTargets.get(target.entryId)
    if (!row || row.collectionKind === 'global' || row.routePattern === '') {
      return { href: null, reason: 'missing', targetTitle: '' }
    }
    return {
      href: null,
      reason: 'not-live',
      targetTitle: entryTitle(row.draftData, row.fields, row.slug),
    }
  }
  /** The resolver for the text of one entry or section. */
  function linksFrom(source: {
    id: string
    title: string
    collectionKey: string
    global: boolean
  }): LinkResolver {
    return {
      resolve: (target, locale) => resolveSnapshotLink(target, locale),
      report(field, locale, issues) {
        for (const issue of issues) {
          const sourceEntryId = source.id
          const warning: LinkWarning = {
            sourceEntryId,
            sourceTitle: source.title,
            sourceCollectionKey: source.collectionKey,
            sourceGlobal: source.global,
            locale,
            field,
            targetEntryId: issue.entryId,
            targetTitle: issue.targetTitle,
            anchor: issue.anchor,
            reason: issue.reason,
          }
          linkWarnings.set(
            [
              sourceEntryId,
              locale ?? '',
              field,
              issue.entryId,
              issue.anchor ?? '',
              issue.reason,
            ].join('|'),
            warning,
          )
        }
      },
    }
  }

  const collections: Record<string, SnapshotEntry[]> = {}
  for (const key of enabled.map((col) => col.key).sort()) {
    const items = included
      .filter((item) => item.collectionKey === key)
      .sort(compareSnapshotEntries)
    const converted: SnapshotEntry[] = []
    for (const item of items) {
      const expanded = await expandAcrossLanguages(
        languages,
        item.fields,
        item.data,
        (view, locale) => expandEntry(item, view, locale),
      )
      converted.push({
        id: item.row.id,
        slug: expanded.top.slug,
        publishedAt: item.publishedAt?.toISOString() ?? null,
        data: expanded.top.data,
        seo: expanded.top.seo,
        ...localeFields(expanded),
      })
    }
    collections[key] = converted
  }

  const globals: Record<string, SnapshotGlobal> = {}
  const globalSchema: Record<string, GlobalConfig> = {}
  for (const section of sections) {
    const item = sectionItems.get(section.key)
    const id = item?.row.id ?? unreadySections.get(section.key)
    if (!id) continue
    // A section with no ready data ships `{}` in the site's base language.
    const expanded = item
      ? await expandAcrossLanguages(
          languages,
          section.fields,
          item.data,
          (view, locale) => expandSection(section, item, view, locale),
        )
      : { top: await expandSection(section, undefined, {}, null) }
    globals[section.key] = {
      id,
      publishedAt: item?.publishedAt?.toISOString() ?? null,
      data: expanded.top.data,
      ...(expanded.top.seo ? { seo: expanded.top.seo } : {}),
      ...localeFields(expanded),
    }
    globalSchema[section.key] = {
      label: section.label,
      fields: structuredClone(section.fields),
      seo: section.seoEnabled,
      ...(section.previewPath ? { previewPath: section.previewPath } : {}),
      ...(languages && section.requiredLanguages.length > 0
        ? { requiredLanguages: [...section.requiredLanguages] }
        : {}),
    }
  }

  // Sections are hashed only when there are some, so a site without them
  // keeps the collections hash it always had. Language sites also hash their
  // languages; locales are part of the entries and so already hashed.
  const hasGlobals = Object.keys(globals).length > 0
  const hash = languages
    ? hashContent({
        languages,
        collections,
        ...(hasGlobals ? { globals } : {}),
      })
    : hasGlobals
      ? hashContent({ collections, globals })
      : hashContent(collections)
  const snapshot: Snapshot = {
    publicationId: '',
    siteKey: existingSite.slug,
    createdAt: now.toISOString(),
    hash,
    // Absent on single-language sites. Outside the hash: `languages` is hashed above.
    ...(languages ? { languages } : {}),
    collections,
    // Present only with sections. `globals` is hashed (see below); `globalSchema`
    // is not, like `schema`.
    ...(hasGlobals ? { globals, globalSchema } : {}),
    // Outside the hash: it describes the collections, it is not content.
    // Language settings are embedded only on language sites.
    schema: buildSnapshotSchema(
      languages
        ? enabled
        : enabled.map((col) => ({
            key: col.key,
            label: col.label,
            routePattern: col.routePattern,
            fields: col.fields,
          })),
    ),
    // Outside the hash: it is derived from the content.
    assets: await snapshotAssets(
      existingSite.organizationId,
      { ...collections, ...globalsAsEntryLists(globals) },
      connection,
    ),
  }

  /** One collection entry in one language (`locale` null on single-language sites). */
  async function expandEntry(
    item: IncludedEntry,
    view: EntryData,
    locale: string | null,
  ): Promise<{ slug: string; data: Record<string, unknown>; seo: SeoMeta }> {
    const isTranslation = Boolean(
      languages && locale && locale !== languages.main,
    )
    const localSlug = isTranslation ? view[SLUG_KEY] : undefined
    const slug =
      typeof localSlug === 'string' && localSlug !== '' ? localSlug : item.slug
    const shown: EntryData = { ...view }
    const slugField = item.fields.find((field) => field.type === 'slug')
    if (isTranslation && slugField) shown[slugField.key] = slug
    const data = await convertFields(item.fields, shown, {
      includedById,
      connection,
      assets,
      siteId,
      organizationId: siteRow.organizationId,
      strict: true,
      locale: locale ?? undefined,
      links: linksFrom({
        id: item.row.id,
        title: entryTitle(shown, item.fields, slug),
        collectionKey: item.collectionKey,
        global: false,
      }),
    })
    const ogImageId = readEntrySeo(shown).ogImage
    const routePattern =
      (isTranslation ? item.localizedRoutes?.[locale!] : undefined) ??
      item.routePattern
    return {
      slug,
      data,
      seo: buildEntrySeo({
        fields: item.fields,
        data: shown,
        converted: data,
        slug,
        routePattern,
        site: siteRow,
        // A missing OG image falls back to the hero image rather than
        // blocking the whole publication.
        ogImage: ogImageId
          ? (resolveAssetFromLookup(assets, ogImageId, locale) ?? null)
          : null,
        publishedAt: item.publishedAt,
      }),
    }
  }

  /** One site content section in one language. `item` is null for an unready section. */
  async function expandSection(
    section: (typeof sections)[number],
    item: IncludedEntry | undefined,
    view: EntryData,
    locale: string | null,
  ): Promise<{ data: Record<string, unknown>; seo?: SeoMeta }> {
    const data = item
      ? await convertFields(section.fields, view, {
          includedById,
          connection,
          assets,
          siteId,
          organizationId: siteRow.organizationId,
          strict: true,
          locale: locale ?? undefined,
          links: linksFrom({
            id: item.row.id,
            title: section.label,
            collectionKey: section.key,
            global: true,
          }),
        })
      : {}
    const seo = section.seoEnabled
      ? buildEntrySeo({
          fields: section.fields,
          data: view,
          converted: data,
          slug: GLOBAL_ENTRY_SLUG,
          routePattern: '',
          url: globalPublicUrl(siteRow.productionUrl, section.previewPath),
          title: section.label,
          site: siteRow,
          ogImage: item ? resolveOgImage(view, assets) : null,
          publishedAt: item?.publishedAt ?? null,
        })
      : undefined
    return { data, ...(seo ? { seo } : {}) }
  }

  return {
    ok: true,
    snapshot,
    hash,
    entryVersions,
    linkWarnings: [...linkWarnings.values()],
  }
}

export type PreviewLocaleStatus = { complete: boolean; missing: string[] }

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
    async resolve(target, locale) {
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

/** The entries a draft's entry links point at, in any language slot. */
async function draftLinkTargets(
  siteId: string,
  fields: Field[],
  draft: EntryData,
): Promise<Map<string, LinkTargetRow>> {
  const ids = new Set<string>()
  await mapRichTextValues(draft, fields, (json) => {
    for (const target of entryLinkTargets(json)) ids.add(target.entryId)
    return json
  })
  return loadLinkTargets(db, await linkTargetSiteIds(db, siteId), ids)
}

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

function previewLocaleStatus(
  data: EntryData,
  languages: SiteLanguages,
  fields: Field[],
): Record<string, PreviewLocaleStatus> {
  const ctx = localeCtxFor(languages, fields)
  return Object.fromEntries(
    languages.all.map((locale) => {
      const status = localeStatus(data, locale, ctx)
      return [locale, { complete: status.complete, missing: status.missing }]
    }),
  )
}

type PreviewSite = SiteCore
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
  const existingSite = (
    await db
      .select(siteCoreColumns)
      .from(site)
      .where(eq(site.id, siteId))
      .limit(1)
  ).at(0)
  if (!found || !existingSite) return null
  return buildPreviewGlobalFromDraft({
    site: existingSite,
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
  site: PreviewSite
  global: PreviewGlobalRow
  entryRow: { id: string; publishedAt: Date | null }
  draftData: EntryData
  locale?: string | null
}): Promise<PreviewGlobal | null> {
  const { global, draftData, locale } = input
  const existingSite = input.site
  const row = input.entryRow
  if (!global.enabled) return null
  const languages = existingSite.languages ?? null
  const links = draftLinkResolver(
    await draftLinkTargets(existingSite.id, global.fields, draftData),
    languages,
  )
  const { assets, references } = await loadPreviewLookups(
    existingSite,
    global.fields,
    draftData,
  )

  const expanded = await expandAcrossLanguages(
    languages,
    global.fields,
    draftData,
    async (view, loc) => {
      const data = await convertFields(global.fields, view, {
        includedById: new Map(),
        siteId: existingSite.id,
        organizationId: existingSite.organizationId,
        assets,
        references,
        strict: false,
        locale: loc ?? undefined,
        links,
      })
      const seo = global.seoEnabled
        ? buildEntrySeo({
            fields: global.fields,
            data: view,
            converted: data,
            slug: GLOBAL_ENTRY_SLUG,
            routePattern: '',
            url: globalPublicUrl(
              existingSite.productionUrl,
              global.previewPath,
            ),
            title: global.label,
            site: existingSite,
            ogImage: resolveOgImage(view, assets),
            publishedAt: row.publishedAt,
          })
        : undefined
      return { data, ...(seo ? { seo } : {}) }
    },
    locale ?? null,
  )

  return {
    id: row.id,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    data: expanded.top.data,
    ...(expanded.top.seo ? { seo: expanded.top.seo } : {}),
    ...localeFields(expanded),
    ...previewLanguageFields(expanded, languages, global.fields, draftData),
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
  const existingSite = (
    await db
      .select(siteCoreColumns)
      .from(site)
      .where(eq(site.id, siteId))
      .limit(1)
  ).at(0)
  if (!col || !existingSite) return null

  const row = (
    await db
      .select()
      .from(entry)
      .where(and(eq(entry.collectionId, col.id), eq(entry.slug, slug)))
      .limit(1)
  ).at(0)
  if (!row) return null
  return buildPreviewEntryFromDraft({
    site: existingSite,
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
  site: PreviewSite
  collection: PreviewCollection
  entryRow: { id: string; slug: string; publishedAt: Date | null }
  draftData: EntryData
  locale?: string | null
}): Promise<PreviewEntry> {
  const { collection: col, draftData, locale } = input
  const existingSite = input.site
  const row = input.entryRow
  const languages = existingSite.languages ?? null
  const links = draftLinkResolver(
    await draftLinkTargets(existingSite.id, col.fields, draftData),
    languages,
  )
  const { assets, references } = await loadPreviewLookups(
    existingSite,
    col.fields,
    draftData,
  )

  const expanded = await expandAcrossLanguages(
    languages,
    col.fields,
    draftData,
    async (view, loc) => {
      const isTranslation = Boolean(languages && loc && loc !== languages.main)
      const localSlug = isTranslation ? view[SLUG_KEY] : undefined
      const entrySlug =
        typeof localSlug === 'string' && localSlug !== '' ? localSlug : row.slug
      const shown: EntryData = { ...view }
      const slugField = col.fields.find((field) => field.type === 'slug')
      if (isTranslation && slugField) shown[slugField.key] = entrySlug
      const data = await convertFields(col.fields, shown, {
        includedById: new Map(),
        siteId: existingSite.id,
        organizationId: existingSite.organizationId,
        assets,
        references,
        strict: false,
        locale: loc ?? undefined,
        links,
      })
      const ogImageId = readEntrySeo(shown).ogImage
      const ogImage: ImageValue | null = ogImageId
        ? resolveAssetFromLookup(assets, ogImageId, loc)
        : null
      const routePattern =
        (isTranslation ? col.localizedRoutes?.[loc!] : undefined) ??
        col.routePattern
      return {
        slug: entrySlug,
        data,
        seo: buildEntrySeo({
          fields: col.fields,
          data: shown,
          converted: data,
          slug: entrySlug,
          routePattern,
          site: existingSite,
          ogImage,
          publishedAt: row.publishedAt,
        }),
      }
    },
    locale ?? null,
  )

  return {
    id: row.id,
    slug: expanded.top.slug,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    data: expanded.top.data,
    seo: expanded.top.seo,
    ...localeFields(expanded),
    ...previewLanguageFields(expanded, languages, col.fields, draftData),
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
  return {
    isFallback: expanded.isFallback ?? false,
    localeStatus: previewLocaleStatus(draft, languages, fields),
  }
}

/**
 * Runs `expand` once per shipped language and picks the top-level value: the
 * main language when it ships, else the first shipped language in site order
 * (the fallback chain). Single-language sites expand the base only.
 */
async function expandAcrossLanguages<T>(
  languages: SiteLanguages | null,
  fields: Field[],
  data: EntryData,
  expand: (view: EntryData, locale: string | null) => Promise<T>,
  requested: string | null = null,
): Promise<{
  top: T
  locale?: string
  locales?: Record<string, T>
  isFallback?: boolean
}> {
  if (!languages) return { top: await expand(data, null) }
  const ctx = localeCtxFor(languages, fields)
  const shipped = shippedLocales(data, ctx)
  const resolved = resolveChain(requested, shipped, ctx)
  const top = resolved?.locale ?? ctx.main
  const locales: Record<string, T> = {}
  for (const locale of shipped) {
    locales[locale] = await expand(readLocale(data, locale, ctx), locale)
  }
  const topValue =
    locales[top] ?? (await expand(readLocale(data, top, ctx), top))
  const isFallback =
    resolved?.isFallback ?? (requested != null && requested !== ctx.main)
  return { top: topValue, locale: top, locales, isFallback }
}

/** `locale` and `locales` for a language site; nothing on a single-language one. */
function localeFields<T>(expanded: {
  locale?: string
  locales?: Record<string, T>
}): { locale?: string; locales?: Record<string, T> } {
  return expanded.locale === undefined
    ? {}
    : { locale: expanded.locale, locales: expanded.locales }
}

function compareSnapshotEntries(a: IncludedEntry, b: IncludedEntry) {
  const aAt = a.publishedAt?.toISOString() ?? ''
  const bAt = b.publishedAt?.toISOString() ?? ''
  if (aAt !== bAt) return bAt.localeCompare(aAt)
  return a.slug.localeCompare(b.slug)
}

async function convertFields(
  fields: Field[],
  data: EntryData,
  options: {
    includedById: Map<string, IncludedEntry>
    siteId: string
    connection?: DbReader
    /** Preloaded assets (snapshot builds); otherwise each asset is queried. */
    assets?: AssetLookup
    organizationId: string
    strict: boolean
    /** Language of the view: image alt text follows it. */
    locale?: string
    /** Entry links in rich text resolve through this. Absent: links are kept as stored. */
    links?: LinkResolver
    /** Preloaded reference targets of the site (previews); otherwise each is queried. */
    references?: Map<string, ReferenceValue>
  },
): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = withoutSeo(
    pickDeclaredFields(fields, data),
  )

  for (const field of fields) {
    const value = data[field.key]
    if (field.type === 'richtext') {
      const authorized = options.assets
        ? richTextAssetsAuthorizedFrom(value, options.assets)
        : await richTextAssetsAuthorized(
            value,
            options.organizationId,
            options.connection,
          )
      if (!authorized) {
        if (options.strict)
          throw new ValidationError([
            {
              path: field.key,
              message: 'Embedded asset not found in this organization',
            },
          ])
        out[field.key] = null
        continue
      }
      if (value == null || value === '') {
        out[field.key] = value
        continue
      }
      // Entry links take the path of their target in this language. A link
      // that cannot work becomes plain text (see resolveEntryLinks).
      let source = value
      if (options.links) {
        const linked = await resolveEntryLinks(value, (target) =>
          options.links!.resolve(target, options.locale ?? null),
        )
        options.links.report(field.key, options.locale ?? null, linked.issues)
        source = linked.json
      }
      try {
        if (options.strict || validateRichText(source).length === 0) {
          out[field.key] = convertRichText(source)
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
      const resolved = options.assets
        ? resolveAssetFromLookup(options.assets, value, options.locale)
        : await resolveAssetValue(
            value,
            options.organizationId,
            options.connection,
            options.locale,
          )
      if (resolved) {
        out[field.key] = resolved
      } else if (options.strict) {
        throw new ValidationError([
          { path: field.key, message: `asset not found: ${value}` },
        ])
      } else {
        out[field.key] = null
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
          slug: target.slug,
          id: target.row.id,
        }
        out[field.key] = ref
        continue
      }
      out[field.key] = null
      if (!options.strict && field.collection && options.references) {
        const ref = options.references.get(value)
        if (ref && ref.collection === field.collection) out[field.key] = ref
      } else if (!options.strict && field.collection) {
        const refRow = (
          await db
            .select({
              id: entry.id,
              slug: entry.slug,
              collectionKey: collection.key,
            })
            .from(entry)
            .innerJoin(collection, eq(entry.collectionId, collection.id))
            .where(
              and(
                eq(entry.id, value),
                eq(entry.siteId, options.siteId),
                ...(field.collection
                  ? [eq(collection.key, field.collection)]
                  : []),
              ),
            )
            .limit(1)
        ).at(0)
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

function hashContent(value: unknown) {
  return createHash('sha256').update(stableStringify(value)).digest('hex')
}

function resolveOgImage(
  data: EntryData,
  assets: AssetLookup,
): ImageValue | null {
  const id = readEntrySeo(data).ogImage
  return id ? resolveAssetFromLookup(assets, id) : null
}

type AssetRefs = { ids: Set<string>; storageKeys: Set<string> }

/** The asset ids and storage keys `scopes` (language views of one item) use. */
function collectAssetRefs(
  fields: Field[],
  scopes: EntryData[],
  refs: AssetRefs,
) {
  for (const scope of scopes) {
    const ogImage = readEntrySeo(scope).ogImage
    if (ogImage) refs.ids.add(ogImage)
    for (const field of fields) {
      const value = scope[field.key]
      if (field.type === 'richtext') {
        for (const key of richTextAssetRefs(value).storageKeys)
          refs.storageKeys.add(key)
      } else if (
        field.type === 'image' &&
        typeof value === 'string' &&
        value !== ''
      ) {
        refs.ids.add(value)
      }
    }
  }
}

/**
 * The assets and reference targets a draft preview uses, in every language,
 * read once instead of one query per image and per reference.
 */
async function loadPreviewLookups(
  previewSite: PreviewSite,
  fields: Field[],
  draftData: EntryData,
): Promise<{ assets: AssetLookup; references: Map<string, ReferenceValue> }> {
  const languages = previewSite.languages ?? null
  const scopes = languages
    ? languages.all.map((locale) =>
        readLocale(draftData, locale, localeCtxFor(languages, fields)),
      )
    : [draftData]
  const assetRefs: AssetRefs = { ids: new Set(), storageKeys: new Set() }
  collectAssetRefs(fields, scopes, assetRefs)

  const referenceIds = new Set<string>()
  for (const scope of scopes) {
    for (const field of fields) {
      const value = scope[field.key]
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
