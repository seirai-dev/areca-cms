import { richTextAssetsAuthorizedFrom } from '#/server/assets/richtext-ownership'
import { createHash } from 'node:crypto'
import { and, eq, inArray, or } from 'drizzle-orm'

import { db } from '#/db'
import type { DbReader } from '#/db'
import { entry } from '#/db/schema'
import { GLOBAL_ENTRY_SLUG, globalsAsEntryLists } from '#/lib/globals'
import { normalizeBase } from '#/lib/content-locale'
import { entryPublicUrl } from '#/lib/seo'
import type {
  EntryData,
  Field,
  GlobalConfig,
  SiteLanguages,
  Snapshot,
  SnapshotEntry,
  SnapshotGlobal,
} from '#/lib/types'
import { loadAssetLookup, resolveAssetFromLookup } from '#/server/assets'
import type { AssetLookup } from '#/server/assets'
import { snapshotAssets } from '#/server/assets/published-assets'
import { entryLinkTargets } from '#/server/richtext/entry-links'
import { stableStringify } from '#/lib/stable-json'

import { listCollections } from './collections.ts'
import { listGlobals } from './globals.ts'
import {
  formatLanguageBlockers,
  languageBlockers,
  localeCtxFor,
} from './locale-validation.ts'
import { linkTargetSiteIds, loadLinkTargets } from './entry-links.ts'
import type { LinkTargetRow } from './entry-links.ts'
import {
  collectAssetRefs,
  expandAcrossLanguages,
  expandEntryView,
  expandSectionView,
  languageViews,
  localeFields,
} from './snapshot-expand.ts'
import type { AssetRefs, ExpandContext } from './snapshot-expand.ts'
import { createSnapshotLinks } from './snapshot-links.ts'
import type { LinkWarning } from './snapshot-links.ts'
import { buildSnapshotSchema } from './snapshot-schema.ts'
import { validateEntryData } from './validation.ts'
import { getSiteOrThrow } from './site-core.ts'
import type { SiteCore } from './site-core.ts'

export type { LinkWarning } from './snapshot-links.ts'

/** The entry columns a snapshot reads. Drafts and baselines are left out. */
const snapshotEntryColumns = {
  id: entry.id,
  collectionId: entry.collectionId,
  slug: entry.slug,
  status: entry.status,
  publishedData: entry.publishedData,
  publishedSlug: entry.publishedSlug,
  publishedAt: entry.publishedAt,
  scheduledData: entry.scheduledData,
  scheduledSlug: entry.scheduledSlug,
  scheduledVersion: entry.scheduledVersion,
  scheduledAt: entry.scheduledAt,
}

type SnapshotEntryRow = {
  [K in keyof typeof snapshotEntryColumns]: (typeof entry.$inferSelect)[K]
}

type SnapshotCollection = Awaited<ReturnType<typeof listCollections>>[number]
type SnapshotSection = Awaited<ReturnType<typeof listGlobals>>[number]

/** An entry or section in the release, with its approved data. */
type IncludedEntry = {
  id: string
  collectionKey: string
  /** Empty for a site content section. */
  routePattern: string
  /** Per-language route patterns. Collections only. */
  localizedRoutes?: Record<string, string> | null
  fields: Field[]
  data: EntryData
  slug: string
  publishedAt: Date | null
}

type EntryVersion = { entryId: string; scheduledVersion: string }

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
 * The release: every approved entry and section, checked and expanded into
 * the published snapshot. The hash covers the content only, so an unchanged
 * site keeps its hash.
 */
export async function buildSnapshot(
  siteId: string,
  connection: DbReader = db,
  options: SnapshotOptions = {},
): Promise<
  | {
      ok: true
      snapshot: Snapshot
      hash: string
      entryVersions: EntryVersion[]
      linkWarnings: LinkWarning[]
    }
  | { ok: false; errors: string[] }
> {
  const site = await getSiteOrThrow(siteId, connection)
  const now = new Date()
  // Null on a single-language site: every language step below is skipped.
  const languages: SiteLanguages | null = site.languages ?? null
  const enabled = await listCollections(
    siteId,
    { enabledOnly: true },
    connection,
  )
  const sections = await listGlobals(siteId, { enabledOnly: true }, connection)
  const rowsByCollection = await loadEntryRows(
    connection,
    siteId,
    enabled,
    sections,
  )

  const approved = new Approval(now, languages)
  const included = enabled.flatMap((col) =>
    approved.collectionEntries(col, rowsByCollection.get(col.id) ?? []),
  )
  const sectionItems = new Map<string, IncludedEntry>()
  for (const section of sections) {
    const item = approved.section(
      section,
      rowsByCollection.get(section.id)?.at(0),
      options,
    )
    if (item) sectionItems.set(section.key, item)
  }
  const { errors, entryVersions, unreadySections } = approved
  errors.push(...routeErrors(included, site.productionUrl))

  // Sections take part in reference and asset checks like any entry.
  const everything = [...included, ...sectionItems.values()]
  const includedById = new Map(everything.map((item) => [item.id, item]))
  const { assets, linkTargets } = await loadReleaseLookups(
    connection,
    site,
    everything,
    languages,
  )
  errors.push(...contentErrors(everything, includedById, assets, languages))
  if (errors.length > 0) {
    // Language views share their shared fields, so one problem can repeat.
    return { ok: false, errors: languages ? [...new Set(errors)] : errors }
  }

  const links = createSnapshotLinks(includedById, linkTargets, languages)
  const ctx: ExpandContext = {
    site,
    languages,
    assets,
    strict: true,
    reference(id) {
      const target = includedById.get(id)
      return target
        ? { collection: target.collectionKey, slug: target.slug, id: target.id }
        : null
    },
    links: links.linksFor,
  }
  const collections = expandCollections(ctx, enabled, included)
  const { globals, globalSchema } = expandGlobals(
    ctx,
    sections,
    sectionItems,
    unreadySections,
  )

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
    siteKey: site.slug,
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
      site.organizationId,
      { ...collections, ...globalsAsEntryLists(globals) },
      connection,
    ),
  }

  return {
    ok: true,
    snapshot,
    hash,
    entryVersions,
    linkWarnings: links.warnings(),
  }
}

/** One read for every enabled collection and section, grouped by collection. */
async function loadEntryRows(
  connection: DbReader,
  siteId: string,
  enabled: { id: string }[],
  sections: { id: string }[],
): Promise<Map<string, SnapshotEntryRow[]>> {
  const rowsByCollection = new Map<string, SnapshotEntryRow[]>()
  if (enabled.length + sections.length === 0) return rowsByCollection
  const rows = await connection
    .select(snapshotEntryColumns)
    .from(entry)
    .where(
      and(
        eq(entry.siteId, siteId),
        or(
          enabled.length > 0
            ? and(
                inArray(
                  entry.collectionId,
                  enabled.map((col) => col.id),
                ),
                or(
                  eq(entry.status, 'published'),
                  eq(entry.status, 'scheduled'),
                ),
              )
            : undefined,
          sections.length > 0
            ? and(
                inArray(
                  entry.collectionId,
                  sections.map((section) => section.id),
                ),
                eq(entry.slug, GLOBAL_ENTRY_SLUG),
              )
            : undefined,
        ),
      ),
    )
  for (const row of rows) {
    const list = rowsByCollection.get(row.collectionId)
    if (list) list.push(row)
    else rowsByCollection.set(row.collectionId, [row])
  }
  return rowsByCollection
}

/** The version a release ships: the scheduled one once it is due, else the published one. */
function approvedVersionOf(row: SnapshotEntryRow, now: Date) {
  const due =
    row.status === 'scheduled' &&
    row.scheduledAt != null &&
    row.scheduledAt <= now
  return {
    due,
    data: due ? row.scheduledData : row.publishedData,
    slug: due ? row.scheduledSlug : row.publishedSlug,
    publishedAt: due ? row.scheduledAt : row.publishedAt,
  }
}

/**
 * Picks the approved version of each entry and section, and collects what
 * blocks the release, the scheduled versions it ships, and the sections that
 * ship `{}` because they were never marked ready.
 */
class Approval {
  readonly errors: string[] = []
  readonly entryVersions: EntryVersion[] = []
  /** Section key to entry id. */
  readonly unreadySections = new Map<string, string>()

  constructor(
    private readonly now: Date,
    private readonly languages: SiteLanguages | null,
  ) {}

  collectionEntries(
    col: SnapshotCollection,
    rows: SnapshotEntryRow[],
  ): IncludedEntry[] {
    const out: IncludedEntry[] = []
    for (const row of rows) {
      const version = approvedVersionOf(row, this.now)
      const { due, data, slug } = version
      if (!due && row.status === 'scheduled' && !data) continue
      if (!slug) {
        this.errors.push(`${col.key}/${row.id}: missing approved slug`)
        continue
      }
      if (due && !row.scheduledVersion) {
        this.errors.push(`${col.key}/${row.id}: missing scheduled version`)
        continue
      }
      if (data == null) {
        this.errors.push(`${col.key}/${row.slug}: missing published data`)
        continue
      }
      const checked = this.checked(col, data, `${col.key}/${row.slug}`)
      if (!checked) continue
      if (due)
        this.entryVersions.push({
          entryId: row.id,
          scheduledVersion: row.scheduledVersion!,
        })
      out.push({
        id: row.id,
        slug,
        collectionKey: col.key,
        routePattern: col.routePattern,
        localizedRoutes: col.localizedRoutes,
        fields: col.fields,
        data: checked,
        publishedAt: version.publishedAt,
      })
    }
    return out
  }

  /**
   * A site content section: one `$global` entry. A section with no ready data
   * blocks go live only when it has required fields; otherwise it ships `{}`.
   */
  section(
    section: SnapshotSection,
    row: SnapshotEntryRow | undefined,
    options: SnapshotOptions,
  ): IncludedEntry | null {
    if (!row) {
      this.errors.push(`Site content "${section.label}": entry is missing`)
      return null
    }
    const version = approvedVersionOf(row, this.now)
    const data = row.status === 'draft' ? null : version.data
    if (data == null) {
      if (section.fields.some((field) => field.required)) {
        if (!options.allowNeverReadySections) {
          this.errors.push(
            `Site content "${section.label}" has required fields and has never been marked ready.`,
          )
        }
      } else {
        this.unreadySections.set(section.key, row.id)
      }
      return null
    }
    if (version.due) {
      if (!row.scheduledVersion) {
        this.errors.push(`${section.key}: missing scheduled version`)
        return null
      }
      this.entryVersions.push({
        entryId: row.id,
        scheduledVersion: row.scheduledVersion,
      })
    }
    const checked = this.checked(
      section,
      data,
      `Site content "${section.label}"`,
    )
    if (!checked) return null
    return {
      id: row.id,
      collectionKey: section.key,
      routePattern: '',
      fields: section.fields,
      data: checked,
      slug: GLOBAL_ENTRY_SLUG,
      publishedAt: version.publishedAt,
    }
  }

  /**
   * `data` validated against `def` and, on a language site, normalized. Null
   * when it is invalid. Missing translations are reported but keep the item.
   */
  private checked(
    def: { fields: Field[]; requiredLanguages: string[] },
    data: EntryData,
    label: string,
  ): EntryData | null {
    const parsed = validateEntryData(def.fields, data)
    if (!parsed.ok) {
      for (const err of parsed.errors) {
        this.errors.push(
          `${label}: ${err.path ? `${err.path}: ` : ''}${err.message}`,
        )
      }
      return null
    }
    const { languages } = this
    if (!languages) return parsed.data
    const normalized = normalizeBase(
      parsed.data,
      localeCtxFor(languages, def.fields),
    )
    const gaps = languageBlockers({
      data: normalized,
      fields: def.fields,
      languages,
      requiredLanguages: def.requiredLanguages,
    })
    if (gaps.length > 0) {
      this.errors.push(`${label}: ${formatLanguageBlockers(gaps)}`)
    }
    return normalized
  }
}

/** Two entries of a collection with one slug, or two pages on one URL. */
function routeErrors(included: IncludedEntry[], productionUrl: string) {
  const errors: string[] = []
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
    const url = entryPublicUrl(productionUrl, item.routePattern, item.slug)
    if (!url) continue
    const owner = entriesByUrl.get(url)
    if (owner) {
      errors.push(
        `Route collision: two pages use the same URL ${url}: "${owner.collectionKey}/${owner.slug}" and "${item.collectionKey}/${item.slug}". Change a page slug or content type route before publishing.`,
      )
    }
    entriesByUrl.set(url, item)
  }
  return errors
}

/**
 * The assets and entry link targets any language view uses, each read in one
 * batch. Link targets outside the release are read too, to tell a draft from
 * an entry that does not exist.
 */
async function loadReleaseLookups(
  connection: DbReader,
  site: SiteCore,
  everything: IncludedEntry[],
  languages: SiteLanguages | null,
): Promise<{ assets: AssetLookup; linkTargets: Map<string, LinkTargetRow> }> {
  const assetRefs: AssetRefs = { ids: new Set(), storageKeys: new Set() }
  const linkTargetIds = new Set<string>()
  for (const item of everything) {
    const views = languageViews(languages, item.fields, item.data)
    collectAssetRefs(item.fields, views, assetRefs)
    for (const view of views) {
      for (const field of item.fields) {
        if (field.type !== 'richtext') continue
        for (const target of entryLinkTargets(view[field.key])) {
          linkTargetIds.add(target.entryId)
        }
      }
    }
  }
  const assets = await loadAssetLookup(
    site.organizationId,
    assetRefs,
    connection,
  )
  const linkTargets = await loadLinkTargets(
    connection,
    await linkTargetSiteIds(connection, site.id),
    linkTargetIds,
  )
  return { assets, linkTargets }
}

/**
 * References and assets every language view must resolve: a translation may
 * point at an asset or entry the snapshot does not have.
 */
function contentErrors(
  everything: IncludedEntry[],
  includedById: Map<string, IncludedEntry>,
  assets: AssetLookup,
  languages: SiteLanguages | null,
) {
  const errors: string[] = []
  for (const item of everything) {
    const label = `${item.collectionKey}/${item.slug}`
    for (const view of languageViews(languages, item.fields, item.data)) {
      for (const field of item.fields) {
        if (field.type !== 'reference') continue
        const value = view[field.key]
        if (value == null || value === '') continue
        if (typeof value !== 'string') {
          errors.push(`${label}: ${field.key}: expected an entry id`)
          continue
        }
        const target = includedById.get(value)
        if (!target) {
          errors.push(
            `${label}: ${field.key}: referenced entry is not in the snapshot`,
          )
          continue
        }
        if (field.collection && target.collectionKey !== field.collection) {
          errors.push(
            `${label}: ${field.key}: referenced entry is not in "${field.collection}"`,
          )
        }
      }

      for (const field of item.fields) {
        if (
          field.type === 'richtext' &&
          !richTextAssetsAuthorizedFrom(view[field.key], assets)
        ) {
          errors.push(
            `${label}: ${field.key}: embedded asset not found in this organization`,
          )
        }
        if (field.type !== 'image') continue
        const value = view[field.key]
        if (value == null || value === '') continue
        if (typeof value !== 'string') {
          errors.push(`${label}: ${field.key}: expected an asset id`)
          continue
        }
        if (!resolveAssetFromLookup(assets, value)) {
          errors.push(`${label}: ${field.key}: asset not found`)
        }
      }
    }
  }
  return errors
}

/** Every enabled collection by key, its entries newest first. */
function expandCollections(
  ctx: ExpandContext,
  enabled: SnapshotCollection[],
  included: IncludedEntry[],
): Record<string, SnapshotEntry[]> {
  const collections: Record<string, SnapshotEntry[]> = {}
  for (const key of enabled.map((col) => col.key).sort()) {
    collections[key] = included
      .filter((item) => item.collectionKey === key)
      .sort(compareSnapshotEntries)
      .map((item) => {
        const expanded = expandAcrossLanguages(
          ctx.languages,
          item.fields,
          item.data,
          (view, locale) => expandEntryView(ctx, item, view, locale),
        )
        return {
          id: item.id,
          slug: expanded.top.slug,
          publishedAt: item.publishedAt?.toISOString() ?? null,
          data: expanded.top.data,
          seo: expanded.top.seo,
          ...localeFields(expanded),
        }
      })
  }
  return collections
}

/** Every enabled section with an entry, and the schema the snapshot embeds for it. */
function expandGlobals(
  ctx: ExpandContext,
  sections: SnapshotSection[],
  sectionItems: Map<string, IncludedEntry>,
  unreadySections: Map<string, string>,
) {
  const { languages } = ctx
  const globals: Record<string, SnapshotGlobal> = {}
  const globalSchema: Record<string, GlobalConfig> = {}
  for (const section of sections) {
    const item = sectionItems.get(section.key)
    const id = item?.id ?? unreadySections.get(section.key)
    if (!id) continue
    // A section with no ready data ships `{}` in the site's base language.
    const expanded = item
      ? expandAcrossLanguages(
          languages,
          section.fields,
          item.data,
          (view, locale) => expandSectionView(ctx, section, item, view, locale),
        )
      : { top: expandSectionView(ctx, section, null, {}, null) }
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
  return { globals, globalSchema }
}

function compareSnapshotEntries(a: IncludedEntry, b: IncludedEntry) {
  const aAt = a.publishedAt?.toISOString() ?? ''
  const bAt = b.publishedAt?.toISOString() ?? ''
  if (aAt !== bAt) return bAt.localeCompare(aAt)
  return a.slug.localeCompare(b.slug)
}

function hashContent(value: unknown) {
  return createHash('sha256').update(stableStringify(value)).digest('hex')
}
