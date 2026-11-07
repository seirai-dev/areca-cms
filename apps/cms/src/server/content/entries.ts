import { randomUUID } from 'node:crypto'
import { and, desc, eq, ilike, isNotNull, or, sql } from 'drizzle-orm'

import { db } from '#/db'
import { collection, entry, entryRevision, site, user } from '#/db/schema'
import {
  isIanaTimeZone,
  isPastInstant,
  parseOffsetInstant,
} from '#/lib/schedule-time'
import type {
  ContentKind,
  EntryData,
  EntryStatus,
  Field,
  SiteLanguages,
} from '#/lib/types'
import {
  I18N_KEY,
  LOCALE_KEY,
  normalizeBase,
  readLocale,
} from '#/lib/content-locale'
import { SEO_KEY } from '#/lib/seo'
import { isDevSite } from '#/server/security/site-visibility'
import { m } from '#/paraglide/messages'
import { audit } from '#/server/audit'
import { importExternalImages } from '#/server/assets/external-images'
import { assetAttachLock } from '#/server/assets/usage'

import { archiveDeletedContent } from './deletion-archive'
import { lockSiteLinkIndex, syncEntryLinkIndex } from './entry-link-index.ts'
import { prepareEntryLinks } from './entry-links.ts'
import { sectionChangesOf, sectionSnapshotsOf } from './section-changes.ts'
import { getCollection } from './collections.ts'
import { ConflictError, NotFoundError, ValidationError } from './errors.ts'
import { notCompleteInLocale } from './missing-language.ts'
import { assertSectionSeo, sectionSeoIssue } from './globals.ts'
import { SLUG_PATTERN } from '#/lib/slug'
import { summaryFromParts, toEntrySummary } from '#/lib/content/entry-summary'
import { firstTextField } from '#/lib/content/utils'
import { isMultilingual } from '#/lib/site-languages'
import type { EntrySummary } from '#/lib/content/entry-summary'
import {
  claimedSlugs,
  formatLanguageBlockers,
  languageBlockers,
  localeCtxFor,
  lockSlugClaims,
  toLanguageBlockerDetail,
  validateLocaleSlugs,
} from './locale-validation.ts'
import {
  resolveSlug,
  pickDeclaredFields,
  validateEntryData,
  validateLanguageData,
  validateReferences,
  validateContentOwnership,
} from './validation.ts'

/**
 * Stored data in the shape a site with languages expects: the base holds the
 * main language. Single-language sites are returned unchanged.
 */
export function normalizeEntryData(
  ctx: {
    site: { languages: SiteLanguages | null }
    collection: { fields: Field[] }
  },
  data: EntryData,
): EntryData {
  const languages = ctx.site.languages
  if (!languages) return data
  return normalizeBase(data, localeCtxFor(languages, ctx.collection.fields))
}

/**
 * Checks that an entry can go live and returns what to store. Single-language
 * sites keep the strict validation of the whole entry. On a site with
 * languages, the shared fields and the main language are strictly valid, and
 * every required language is complete. `referenceData` is the flat view that
 * reference targets are checked against.
 */
export function prepareReadyData(
  ctx: {
    site: { languages: SiteLanguages | null }
    collection: { fields: Field[]; requiredLanguages: string[] }
  },
  data: EntryData,
): { stored: EntryData; referenceData: EntryData } {
  const languages = ctx.site.languages
  if (!languages) {
    const parsed = validateEntryData(ctx.collection.fields, data)
    if (!parsed.ok) throw new ValidationError(parsed.errors)
    return { stored: parsed.data, referenceData: data }
  }
  const mainView = readLocale(
    data,
    languages.main,
    localeCtxFor(languages, ctx.collection.fields),
  )
  const strict = validateEntryData(ctx.collection.fields, mainView)
  if (!strict.ok) throw new ValidationError(strict.errors)
  const blockers = languageBlockers({
    data,
    fields: ctx.collection.fields,
    languages,
    requiredLanguages: ctx.collection.requiredLanguages,
  })
  if (blockers.length > 0) {
    throw new ValidationError(
      [{ path: '', message: formatLanguageBlockers(blockers) }],
      { blockers: toLanguageBlockerDetail(blockers) },
    )
  }
  return { stored: data, referenceData: mainView }
}

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

  const totalRow = (
    await db
      .select({ count: sql<number>`count(*)::int` })
      .from(entry)
      .where(where)
  ).at(0)

  return { items, total: totalRow?.count ?? 0 }
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
  const totalRow = (
    await db
      .select({ count: sql<number>`count(*)::int` })
      .from(entry)
      .where(where)
  ).at(0)
  return { items, total: totalRow?.count ?? 0 }
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

export async function getEntry(id: string) {
  return (await findEntryAndSection(id))?.entry ?? null
}

/**
 * The entry, and whether its section is disabled, in the one entry⋈collection
 * read. Access checks use this to decide NotFound for a hidden section without a
 * second query (`access.ts`).
 */
export async function findEntryAndSection(id: string) {
  const row = (
    await db
      .select({
        entry,
        collectionKey: collection.key,
        sectionKind: collection.kind,
        sectionEnabled: collection.enabled,
      })
      .from(entry)
      .innerJoin(collection, eq(entry.collectionId, collection.id))
      .where(eq(entry.id, id))
      .limit(1)
  ).at(0)
  if (!row) return null
  return {
    entry: { ...row.entry, collectionKey: row.collectionKey },
    hiddenSection: row.sectionKind === 'global' && !row.sectionEnabled,
  }
}

export async function createEntry(input: {
  siteId: string
  collectionKey: string
  data: EntryData
  actorId: string
}) {
  const ctx = await loadCollectionContext(input.siteId, input.collectionKey)
  if (!ctx.collection.enabled) {
    throw new NotFoundError(m.server_collection_not_found())
  }

  const validated = validateEntryData(
    ctx.collection.fields,
    normalizeEntryData(ctx, input.data),
    { mode: 'partial', write: true },
  )
  if (!validated.ok) {
    throw new ValidationError(validated.errors)
  }
  const slugErrors = await validateLocaleSlugs({
    collectionId: ctx.collection.id,
    data: validated.data,
  })
  if (slugErrors.length) throw new ValidationError(slugErrors)
  const images = await importEntryImages(ctx, validated.data, input.actorId)
  const parsed = {
    ...validated,
    data: await prepareEntryLinks(
      db,
      ctx.site.id,
      ctx.collection.fields,
      images.data,
    ),
  }
  const headingBaseline = await sectionSnapshotsOf(
    parsed.data,
    ctx.collection.fields,
    ctx.site.languages,
  )

  const slug = resolveSlug(parsed.data, ctx.collection.fields)
  if (!slug || !SLUG_PATTERN.test(slug)) {
    throw new ValidationError([
      { path: 'slug', message: m.server_valid_slug_required() },
    ])
  }

  await assertSlugAvailable(ctx.collection.id, slug)

  return db.transaction(async (tx) => {
    await lockSiteLinkIndex(tx, ctx.site.id)
    await assetAttachLock(tx, ctx.site.organizationId)
    await lockSlugClaims(tx, ctx.collection.id, claimedSlugs(slug, parsed.data))
    await assertUrlsAvailable(tx, ctx.collection.id, parsed.data, slug)
    const ownershipErrors = await validateContentOwnership(
      ctx.site.id,
      ctx.site.organizationId,
      ctx.collection.fields,
      parsed.data,
      tx,
    )
    if (ownershipErrors.length) throw new ValidationError(ownershipErrors)
    const now = new Date()
    const created = (
      await tx
        .insert(entry)
        .values({
          siteId: input.siteId,
          collectionId: ctx.collection.id,
          slug,
          status: 'draft',
          draftData: parsed.data,
          headingBaseline,
          createdBy: input.actorId,
          updatedBy: input.actorId,
          createdAt: now,
          updatedAt: now,
        })
        .returning()
    ).at(0)

    if (!created) {
      throw new Error(m.server_failed_to_create_entry())
    }

    await syncEntryLinkIndex(tx, created.id)
    await writeRevision(created.id, parsed.data, input.actorId, 'create', tx)
    await audit(
      {
        organizationId: ctx.site.organizationId,
        siteId: input.siteId,
        actorId: input.actorId,
        action: 'entry.create',
        targetType: 'entry',
        targetId: created.id,
        meta: { collectionKey: input.collectionKey, slug },
      },
      tx,
      ctx.site,
    )

    return {
      ...created,
      collectionKey: ctx.collection.key,
      importedImages: images.imported,
      importWarnings: images.warnings,
    }
  })
}

export async function updateDraft(
  id: string,
  data: EntryData,
  actorId: string,
  expectedVersion: number,
  /** Rows the caller's access check already read for this entry. */
  preloaded?: EntryContext,
  /**
   * An explicit save (Save, ⌘S, Mark ready, an MCP write) rather than an
   * autosave. Only these take the heading snapshot and report section changes
   * (docs/design/rich-text-links.md, decision 21).
   */
  options: { explicit?: boolean } = {},
) {
  const ctx = preloaded ?? (await loadEntryContext(id))
  const validated = validateEntryData(
    ctx.collection.fields,
    normalizeEntryData(ctx, data),
    { mode: 'partial', write: true },
  )
  if (!validated.ok) {
    throw new ValidationError(validated.errors)
  }
  const slugErrors = await validateLocaleSlugs({
    collectionId: ctx.collection.id,
    entryId: id,
    data: validated.data,
  })
  if (slugErrors.length) throw new ValidationError(slugErrors)
  if (ctx.collection.kind === 'global') {
    assertSectionSeo(ctx.collection, validated.data)
  }
  const images = await importEntryImages(ctx, validated.data, actorId)
  const parsed = {
    ...validated,
    data: await prepareEntryLinks(
      db,
      ctx.site.id,
      ctx.collection.fields,
      images.data,
    ),
  }

  const nextSlug = resolveSlug(parsed.data, ctx.collection.fields)
  if (nextSlug && nextSlug !== ctx.entry.slug) {
    if (!SLUG_PATTERN.test(nextSlug)) {
      throw new ValidationError([
        { path: 'slug', message: m.server_invalid_slug() },
      ])
    }
    await assertSlugAvailable(ctx.collection.id, nextSlug, id)
  }

  const sections = options.explicit
    ? await sectionChangesOf({
        previousData: ctx.entry.draftData,
        baseline: ctx.entry.headingBaseline ?? null,
        nextData: parsed.data,
        fields: ctx.collection.fields,
        languages: ctx.site.languages,
      })
    : null
  // The baseline is the headings at the last explicit save. An explicit save
  // stores the new headings. An entry with no baseline yet (saved before they
  // were kept) stores the headings it had before this save, so an autosave
  // that renames a heading cannot hide the rename from the next explicit save.
  const storedBaseline = sections
    ? sections.next
    : ctx.entry.headingBaseline == null
      ? await sectionSnapshotsOf(
          ctx.entry.draftData,
          ctx.collection.fields,
          ctx.site.languages,
        )
      : null

  return db.transaction(async (tx) => {
    await lockSiteLinkIndex(tx, ctx.site.id)
    await assetAttachLock(tx, ctx.site.organizationId)
    await lockSlugClaims(
      tx,
      ctx.collection.id,
      claimedSlugs(nextSlug ?? ctx.entry.slug, parsed.data),
    )
    await assertUrlsAvailable(
      tx,
      ctx.collection.id,
      parsed.data,
      nextSlug && nextSlug !== ctx.entry.slug ? nextSlug : null,
      id,
    )
    const ownershipErrors = await validateContentOwnership(
      ctx.site.id,
      ctx.site.organizationId,
      ctx.collection.fields,
      parsed.data,
      tx,
    )
    if (ownershipErrors.length) throw new ValidationError(ownershipErrors)
    const now = new Date()
    const updated = (
      await tx
        .update(entry)
        .set({
          contentVersion: sql`${entry.contentVersion} + 1`,
          draftVersion: sql`${entry.draftVersion} + 1`,
          draftData: parsed.data,
          ...(storedBaseline ? { headingBaseline: storedBaseline } : {}),
          slug: nextSlug ?? ctx.entry.slug,
          updatedBy: actorId,
          updatedAt: now,
        })
        .where(and(eq(entry.id, id), eq(entry.draftVersion, expectedVersion)))
        .returning()
    ).at(0)

    if (!updated) {
      throw new ConflictError(
        'DRAFT_CONFLICT: This entry changed on the server. Reload or explicitly reapply your recovered draft.',
      )
    }

    await syncEntryLinkIndex(tx, id)
    await writeRevision(id, parsed.data, actorId, 'update', tx)
    await audit(
      {
        organizationId: ctx.site.organizationId,
        siteId: ctx.site.id,
        actorId,
        action: 'entry.update',
        targetType: 'entry',
        targetId: id,
      },
      tx,
      ctx.site,
    )

    return {
      ...updated,
      collectionKey: ctx.collection.key,
      importedImages: images.imported,
      importWarnings: images.warnings,
      /** Headings a link may point at that this save removed or renamed. */
      sectionChanges: sections?.changes ?? [],
    }
  })
}

/** Revisions per history page. */
export const REVISION_PAGE_SIZE = 30
const REVISION_PAGE_MAX = 100

/** A revision without its data: what the history list shows. */
export type RevisionSummary = {
  id: string
  createdAt: Date
  createdBy: string | null
  note: string | null
  kind: 'autosave' | 'milestone'
}

/**
 * One page of an entry's history, newest first, without the revision data
 * (that is read on demand). `cursor` is the id of the last row of the previous
 * page; the rows are compared in SQL, so no timestamp round trip can skip one.
 */
export async function listRevisions(
  entryId: string,
  options: { cursor?: string | null; limit?: number } = {},
): Promise<{ items: RevisionSummary[]; nextCursor: string | null }> {
  const existing = await getEntry(entryId)
  if (!existing) {
    throw new NotFoundError(m.server_entry_not_found())
  }
  const limit = Math.min(
    Math.max(options.limit ?? REVISION_PAGE_SIZE, 1),
    REVISION_PAGE_MAX,
  )
  const before = options.cursor
    ? sql`(${entryRevision.createdAt}, ${entryRevision.id}) < (select c.created_at, c.id from entry_revision c where c.id = ${options.cursor})`
    : undefined
  const rows = await db
    .select({
      id: entryRevision.id,
      createdAt: entryRevision.createdAt,
      createdBy: entryRevision.createdBy,
      note: entryRevision.note,
      kind: entryRevision.kind,
    })
    .from(entryRevision)
    .where(and(eq(entryRevision.entryId, entryId), before))
    .orderBy(desc(entryRevision.createdAt), desc(entryRevision.id))
    .limit(limit + 1)
  const items = rows.slice(0, limit)
  return {
    items,
    nextCursor: rows.length > limit ? (items.at(-1)?.id ?? null) : null,
  }
}

export async function restoreRevision(
  entryId: string,
  revisionId: string,
  actorId: string,
  expectedVersion: number,
) {
  const initial = await loadEntryContext(entryId)
  const revision = (
    await db
      .select()
      .from(entryRevision)
      .where(
        and(
          eq(entryRevision.id, revisionId),
          eq(entryRevision.entryId, entryId),
        ),
      )
      .limit(1)
  ).at(0)
  if (!revision) {
    throw new NotFoundError(m.server_revision_not_found())
  }

  return db.transaction(async (tx) => {
    await lockSiteLinkIndex(tx, initial.site.id)
    await tx
      .select({ id: site.id })
      .from(site)
      .where(eq(site.id, initial.site.id))
      .for('no key update')
    const ctx = await loadEntryContext(entryId, tx)
    await assetAttachLock(tx, ctx.site.organizationId)
    const prepared = prepareRevisionRestore(
      ctx.collection.fields,
      revision.data,
      ctx.entry.draftData,
    )
    const restoredData = await prepareEntryLinks(
      tx,
      ctx.site.id,
      ctx.collection.fields,
      prepared.data,
    )
    await lockSlugClaims(
      tx,
      ctx.collection.id,
      claimedSlugs(
        resolveSlug(restoredData, ctx.collection.fields) ?? ctx.entry.slug,
        restoredData,
      ),
    )
    const skippedFields = prepared.skippedFields
    // A revision saved while SEO was on keeps the current draft's SEO (none)
    // when the section has SEO off now, as a skipped field, not an error.
    const seoIssue =
      ctx.collection.kind === 'global' && prepared.restoredKeys.has(SEO_KEY)
        ? sectionSeoIssue(ctx.collection, restoredData)
        : null
    if (seoIssue) {
      prepared.restoredKeys.delete(SEO_KEY)
      keepCurrentRevisionField(restoredData, ctx.entry.draftData, SEO_KEY)
      skippedFields.push({ key: SEO_KEY, label: 'SEO', reason: seoIssue })
    }
    for (const key of prepared.restoredKeys) {
      const field = ctx.collection.fields.find((item) => item.key === key)
      const errors = await validateContentOwnership(
        ctx.site.id,
        ctx.site.organizationId,
        field ? [field] : [],
        { [key]: restoredData[key] },
        tx,
      )
      if (errors.length) {
        keepCurrentRevisionField(restoredData, ctx.entry.draftData, key)
        skippedFields.push({
          key,
          label: field?.label ?? 'SEO',
          reason: errors.map((error) => error.message).join('; '),
        })
      }
    }
    let nextSlug = resolveSlug(restoredData, ctx.collection.fields)
    if (nextSlug && nextSlug !== ctx.entry.slug) {
      try {
        await assertSlugAvailable(ctx.collection.id, nextSlug, entryId, tx)
      } catch (error) {
        if (!(error instanceof ConflictError)) throw error
        keepCurrentRevisionField(restoredData, ctx.entry.draftData, 'slug')
        skippedFields.push({
          key: 'slug',
          label:
            ctx.collection.fields.find((field) => field.key === 'slug')
              ?.label ?? 'Slug',
          reason: error.message,
        })
        nextSlug = ctx.entry.slug
      }
    }
    const now = new Date()
    const updated = (
      await tx
        .update(entry)
        .set({
          contentVersion: sql`${entry.contentVersion} + 1`,
          draftVersion: sql`${entry.draftVersion} + 1`,
          draftData: restoredData,
          slug: nextSlug ?? ctx.entry.slug,
          updatedBy: actorId,
          updatedAt: now,
        })
        .where(
          and(eq(entry.id, entryId), eq(entry.draftVersion, expectedVersion)),
        )
        .returning()
    ).at(0)

    if (!updated) {
      throw new ConflictError(
        'DRAFT_CONFLICT: This entry changed on the server.',
      )
    }

    await syncEntryLinkIndex(tx, entryId)
    await writeRevision(entryId, restoredData, actorId, 'restore', tx)
    await audit(
      {
        organizationId: ctx.site.organizationId,
        siteId: ctx.site.id,
        actorId,
        action: 'entry.restore',
        targetType: 'entry',
        targetId: entryId,
        meta: { revisionId },
      },
      tx,
      ctx.site,
    )

    return { ...updated, collectionKey: ctx.collection.key, skippedFields }
  })
}

export type SkippedRevisionField = {
  key: string
  label: string
  reason: string
}

/** Restore schema-compatible values; incompatible or newly added fields keep the current draft. */
export function prepareRevisionRestore(
  fields: Field[],
  historical: EntryData,
  current: EntryData,
) {
  const data = pickDeclaredFields(fields, current)
  const skippedFields: SkippedRevisionField[] = []
  const restoredKeys = new Set<string>()
  for (const key of Object.keys(historical)) {
    if (key === I18N_KEY || key === LOCALE_KEY) {
      // Language keys come back as a whole: the revision's languages replace the draft's.
      const languageErrors = validateLanguageData(fields, {
        [key]: historical[key],
      })
      if (languageErrors.length > 0) {
        skippedFields.push({
          key,
          label: key,
          reason: languageErrors.map((error) => error.message).join('; '),
        })
        continue
      }
      data[key] = historical[key]
      restoredKeys.add(key)
      continue
    }
    const field = fields.find((item) => item.key === key)
    if (!field && key !== SEO_KEY) {
      skippedFields.push({
        key,
        label: key,
        reason: m.server_restore_field_removed(),
      })
      continue
    }
    const result = validateEntryData(
      field ? [field] : [],
      { [key]: historical[key] },
      { mode: 'partial' },
    )
    if (!result.ok) {
      skippedFields.push({
        key,
        label: field?.label ?? 'SEO',
        reason: result.errors.map((error) => error.message).join('; '),
      })
      continue
    }
    data[key] = result.data[key]
    restoredKeys.add(key)
  }
  // Individually valid dates can conflict once merged with retained current values.
  for (let attempt = 0; attempt <= fields.length; attempt++) {
    const result = validateEntryData(fields, data, { mode: 'partial' })
    if (result.ok) break
    let changed = false
    for (const error of result.errors) {
      const field = fields.find((item) => item.key === error.path.split('.')[0])
      const key =
        field && restoredKeys.has(field.key)
          ? field.key
          : field?.after && restoredKeys.has(field.after)
            ? field.after
            : undefined
      if (!key) continue
      keepCurrentRevisionField(data, current, key)
      restoredKeys.delete(key)
      skippedFields.push({
        key,
        label: fields.find((item) => item.key === key)?.label ?? key,
        reason: error.message,
      })
      changed = true
    }
    if (!changed) break
  }
  return { data, skippedFields, restoredKeys }
}

function keepCurrentRevisionField(
  data: EntryData,
  current: EntryData,
  key: string,
) {
  if (Object.hasOwn(current, key)) data[key] = current[key]
  else delete data[key]
}

/** Approval conflict: the draft moved after the reviewer opened it. */
const APPROVAL_CONFLICT_MESSAGE =
  'DRAFT_CONFLICT: Draft changed while approving. Reload and review it.'

/**
 * The draft version an approval applies to. A caller that sent the version it
 * reviewed gets a conflict when the draft has moved on; without one, the
 * version loaded for this request is approved (MCP and bulk callers).
 */
function approvedVersion(current: number, expectedVersion: number | undefined) {
  if (expectedVersion === undefined) return current
  if (expectedVersion !== current) {
    throw new ConflictError(APPROVAL_CONFLICT_MESSAGE)
  }
  return expectedVersion
}

export async function publishEntry(
  id: string,
  actorId: string,
  expectedVersion?: number,
) {
  const ctx = await loadEntryContext(id)
  const reviewed = approvedVersion(ctx.entry.draftVersion, expectedVersion)
  // Drafts saved before external images were imported are caught up here.
  const images = await importEntryImages(ctx, ctx.entry.draftData, actorId)
  const draftData = normalizeEntryData(ctx, images.data)
  const ready = prepareReadyData(ctx, draftData)
  const refErrors = await validateReferences(
    ctx.site.id,
    ctx.collection.fields,
    ready.referenceData,
  )
  if (refErrors.length > 0) {
    throw new ValidationError(refErrors)
  }

  return db.transaction(async (tx) => {
    await lockSiteLinkIndex(tx, ctx.site.id)
    await assetAttachLock(tx, ctx.site.organizationId)
    const ownershipErrors = await validateContentOwnership(
      ctx.site.id,
      ctx.site.organizationId,
      ctx.collection.fields,
      draftData,
      tx,
    )
    if (ownershipErrors.length) throw new ValidationError(ownershipErrors)
    const now = new Date()
    const updated = (
      await tx
        .update(entry)
        .set({
          contentVersion: sql`${entry.contentVersion} + 1`,
          ...(images.imported > 0 || draftData !== images.data
            ? { draftData }
            : {}),
          status: 'published',
          publishedData: ready.stored,
          publishedSlug: ctx.entry.slug,
          publishedAt: now,
          scheduledData: null,
          scheduledSlug: null,
          scheduledVersion: null,
          scheduledAt: null,
          scheduleTimezone: null,
          scheduledBy: null,
          updatedBy: actorId,
          updatedAt: now,
        })
        .where(and(eq(entry.id, id), eq(entry.draftVersion, reviewed)))
        .returning()
    ).at(0)

    if (!updated) {
      throw new ConflictError(APPROVAL_CONFLICT_MESSAGE)
    }

    await syncEntryLinkIndex(tx, id)
    await writeRevision(id, draftData, actorId, 'publish', tx)
    await audit(
      {
        organizationId: ctx.site.organizationId,
        siteId: ctx.site.id,
        actorId,
        action: 'entry.publish',
        targetType: 'entry',
        targetId: id,
      },
      tx,
      ctx.site,
    )

    return {
      ...updated,
      collectionKey: ctx.collection.key,
      importedImages: images.imported,
      importWarnings: images.warnings,
    }
  })
}

export async function unpublishEntry(id: string, actorId: string) {
  const ctx = await loadEntryContext(id)
  assertCollectionEntry(ctx.collection)
  const now = new Date()
  return db.transaction(async (tx) => {
    await lockSiteLinkIndex(tx, ctx.site.id)
    const updated = (
      await tx
        .update(entry)
        .set({
          contentVersion: sql`${entry.contentVersion} + 1`,
          status: 'draft',
          publishedData: null,
          publishedSlug: null,
          publishedAt: null,
          scheduledData: null,
          scheduledSlug: null,
          scheduledVersion: null,
          scheduledAt: null,
          scheduleTimezone: null,
          scheduledBy: null,
          updatedBy: actorId,
          updatedAt: now,
        })
        .where(eq(entry.id, id))
        .returning()
    ).at(0)

    if (!updated) {
      throw new NotFoundError(m.server_entry_not_found())
    }

    await syncEntryLinkIndex(tx, id)
    await writeRevision(id, ctx.entry.draftData, actorId, 'unpublish', tx)
    await audit(
      {
        organizationId: ctx.site.organizationId,
        siteId: ctx.site.id,
        actorId,
        action: 'entry.unpublish',
        targetType: 'entry',
        targetId: id,
      },
      tx,
      ctx.site,
    )

    return { ...updated, collectionKey: ctx.collection.key }
  })
}

export async function archiveEntry(id: string, actorId: string) {
  const ctx = await loadEntryContext(id)
  assertCollectionEntry(ctx.collection)
  const now = new Date()
  const updated = (
    await db
      .update(entry)
      .set({
        contentVersion: sql`${entry.contentVersion} + 1`,
        status: 'archived',
        updatedBy: actorId,
        updatedAt: now,
      })
      .where(eq(entry.id, id))
      .returning()
  ).at(0)

  if (!updated) {
    throw new NotFoundError(m.server_entry_not_found())
  }

  await writeRevision(id, ctx.entry.draftData, actorId, 'archive')
  await audit(
    {
      organizationId: ctx.site.organizationId,
      siteId: ctx.site.id,
      actorId,
      action: 'entry.archive',
      targetType: 'entry',
      targetId: id,
    },
    db,
    ctx.site,
  )

  return { ...updated, collectionKey: ctx.collection.key }
}

export async function scheduleEntry(
  id: string,
  scheduledAt: string,
  timezone: string,
  actorId: string,
  expectedVersion?: number,
) {
  const ctx = await loadEntryContext(id)
  if (isDevSite(ctx.site)) {
    throw new ConflictError(m.server_dev_env_no_scheduling())
  }
  const reviewed = approvedVersion(ctx.entry.draftVersion, expectedVersion)
  if (!timezone) {
    throw new ValidationError([
      { path: 'timezone', message: m.server_timezone_required() },
    ])
  }
  if (!isIanaTimeZone(timezone)) {
    throw new ValidationError([
      { path: 'timezone', message: m.server_invalid_timezone() },
    ])
  }
  const when = parseOffsetInstant(scheduledAt)
  if (!when) {
    throw new ValidationError([
      { path: 'scheduledAt', message: m.server_invalid_datetime() },
    ])
  }
  if (isPastInstant(when)) {
    throw new ValidationError([
      { path: 'scheduledAt', message: m.server_schedule_in_past() },
    ])
  }
  const images = await importEntryImages(ctx, ctx.entry.draftData, actorId)
  const draftData = normalizeEntryData(ctx, images.data)

  return db.transaction(async (tx) => {
    await lockSiteLinkIndex(tx, ctx.site.id)
    await assetAttachLock(tx, ctx.site.organizationId)
    const ownershipErrors = await validateContentOwnership(
      ctx.site.id,
      ctx.site.organizationId,
      ctx.collection.fields,
      draftData,
      tx,
    )
    if (ownershipErrors.length) throw new ValidationError(ownershipErrors)
    const ready = prepareReadyData(ctx, draftData)
    const now = new Date()
    const updated = (
      await tx
        .update(entry)
        .set({
          contentVersion: sql`${entry.contentVersion} + 1`,
          ...(images.imported > 0 || draftData !== images.data
            ? { draftData }
            : {}),
          status: 'scheduled',
          scheduledData: ready.stored,
          scheduledSlug: ctx.entry.slug,
          scheduledVersion: randomUUID(),
          scheduledAt: when,
          scheduleTimezone: timezone,
          scheduledBy: actorId,
          updatedBy: actorId,
          updatedAt: now,
        })
        .where(and(eq(entry.id, id), eq(entry.draftVersion, reviewed)))
        .returning()
    ).at(0)

    if (!updated) {
      throw new ConflictError(APPROVAL_CONFLICT_MESSAGE)
    }

    await syncEntryLinkIndex(tx, id)
    await writeRevision(id, draftData, actorId, 'schedule', tx)
    await audit(
      {
        organizationId: ctx.site.organizationId,
        siteId: ctx.site.id,
        actorId,
        action: 'entry.schedule',
        targetType: 'entry',
        targetId: id,
        meta: { scheduledAt, timezone },
      },
      tx,
      ctx.site,
    )

    return {
      ...updated,
      collectionKey: ctx.collection.key,
      importedImages: images.imported,
      importWarnings: images.warnings,
    }
  })
}

export async function cancelSchedule(id: string, actorId: string) {
  const ctx = await loadEntryContext(id)
  const now = new Date()
  const nextStatus =
    ctx.entry.status === 'scheduled'
      ? ctx.entry.publishedData
        ? 'published'
        : 'draft'
      : ctx.entry.status
  return db.transaction(async (tx) => {
    await lockSiteLinkIndex(tx, ctx.site.id)
    const updated = (
      await tx
        .update(entry)
        .set({
          contentVersion: sql`${entry.contentVersion} + 1`,
          status: nextStatus,
          scheduledData: null,
          scheduledSlug: null,
          scheduledVersion: null,
          scheduledAt: null,
          scheduleTimezone: null,
          scheduledBy: null,
          updatedBy: actorId,
          updatedAt: now,
        })
        .where(eq(entry.id, id))
        .returning()
    ).at(0)

    if (!updated) {
      throw new NotFoundError(m.server_entry_not_found())
    }

    await syncEntryLinkIndex(tx, id)
    await writeRevision(id, ctx.entry.draftData, actorId, 'cancel_schedule', tx)
    await audit(
      {
        organizationId: ctx.site.organizationId,
        siteId: ctx.site.id,
        actorId,
        action: 'entry.cancel_schedule',
        targetType: 'entry',
        targetId: id,
      },
      tx,
      ctx.site,
    )

    return { ...updated, collectionKey: ctx.collection.key }
  })
}

export async function deleteEntry(id: string, actorId: string) {
  const ctx = await loadEntryContext(id)
  assertCollectionEntry(ctx.collection)
  if (isDevSite(ctx.site) && ctx.entry.originEntryId) {
    // A forked dev entry is archived, not deleted: the origin link must
    // survive so that a push can archive the production entry.
    await archiveEntry(id, actorId)
    return
  }
  return db.transaction(async (tx) => {
    await lockSiteLinkIndex(tx, ctx.site.id)
    await archiveDeletedContent(tx, ctx.site.organizationId, 'entry', id)
    await audit(
      {
        organizationId: ctx.site.organizationId,
        siteId: ctx.site.id,
        actorId,
        action: 'entry.delete',
        targetType: 'entry',
        targetId: id,
        meta: { slug: ctx.entry.slug },
      },
      tx,
      ctx.site,
    )
    await tx.delete(entry).where(eq(entry.id, id))
  })
}

/**
 * A person's autosaves within this window of their last autosave update that
 * one revision instead of adding a row. The window is measured from when that
 * revision was created, so a long session still gets a new row every window.
 */
export const AUTOSAVE_COALESCE_MS = 10 * 60 * 1000

/**
 * Records a revision. An autosave by the same person, when the entry's newest
 * revision is their own autosave within the window, replaces that revision's
 * data. Every other write (approval, schedule, publish, restore, another
 * person's change) adds its own revision, so milestones are never merged.
 */
export async function writeRevision(
  entryId: string,
  data: EntryData,
  actorId: string,
  note: string,
  connection: Pick<typeof db, 'insert' | 'execute'> = db,
) {
  if (note !== 'update') {
    await connection.insert(entryRevision).values({
      entryId,
      data,
      createdBy: actorId,
      note,
      kind: 'milestone',
    })
    return
  }
  // An autosave in one statement: update the newest revision when it is this
  // person's autosave inside the window, otherwise insert a new autosave.
  const windowMs = AUTOSAVE_COALESCE_MS
  await connection.execute(sql`
    with input as (
      select ${JSON.stringify(data)}::jsonb as data
    ),
    latest as (
      select ${entryRevision.id} as id, ${entryRevision.kind} as kind,
        ${entryRevision.createdBy} as created_by,
        ${entryRevision.createdAt} as created_at
      from ${entryRevision}
      where ${entryRevision.entryId} = ${entryId}
      order by ${entryRevision.createdAt} desc, ${entryRevision.id} desc
      limit 1
    ),
    coalesced as (
      update ${entryRevision} set data = (select data from input)
      from latest
      where ${entryRevision.id} = latest.id
        and latest.kind = 'autosave'
        and latest.created_by = ${actorId}
        and latest.created_at >= clock_timestamp() - make_interval(secs => ${windowMs / 1000})
      returning ${entryRevision.id}
    )
    insert into ${entryRevision} (id, entry_id, data, created_by, note, kind)
    select ${randomUUID()}, ${entryId}, (select data from input), ${actorId}, 'update', 'autosave'
    where not exists (select 1 from coalesced)
  `)
}

/**
 * The URL checks of a save, run again under the assets lock (the lock a push
 * and a copy take too). The checks before the lock read the URLs as they were
 * before a concurrent push or save committed; this one reads them after.
 */
async function assertUrlsAvailable(
  tx: Pick<typeof db, 'select'>,
  collectionId: string,
  data: EntryData,
  slug: string | null,
  entryId?: string,
) {
  const slugErrors = await validateLocaleSlugs(
    { collectionId, entryId, data },
    tx,
  )
  if (slugErrors.length) throw new ValidationError(slugErrors)
  if (slug) await assertSlugAvailable(collectionId, slug, entryId, tx)
}

async function assertSlugAvailable(
  collectionId: string,
  slug: string,
  excludeId?: string,
  connection: Pick<typeof db, 'select'> = db,
) {
  const existing = (
    await connection
      .select({ id: entry.id })
      .from(entry)
      .where(and(eq(entry.collectionId, collectionId), eq(entry.slug, slug)))
      .limit(1)
  ).at(0)
  if (existing && existing.id !== excludeId) {
    throw new ConflictError(m.server_slug_already_exists())
  }
}

async function loadCollectionContext(siteId: string, collectionKey: string) {
  const row = (
    await db
      .select({ collection, site })
      .from(collection)
      .innerJoin(site, eq(collection.siteId, site.id))
      .where(
        and(
          eq(collection.siteId, siteId),
          eq(collection.key, collectionKey),
          eq(collection.kind, 'collection'),
        ),
      )
      .limit(1)
  ).at(0)
  if (!row) {
    throw new NotFoundError(m.server_collection_not_found())
  }
  return row
}

type EntryContext = {
  entry: typeof entry.$inferSelect
  collection: typeof collection.$inferSelect
  site: typeof site.$inferSelect
}

async function loadEntryContext(
  id: string,
  connection: Pick<typeof db, 'select'> = db,
) {
  const row = (
    await connection
      .select({ entry, collection, site })
      .from(entry)
      .innerJoin(collection, eq(entry.collectionId, collection.id))
      .innerJoin(site, eq(entry.siteId, site.id))
      .where(eq(entry.id, id))
      .limit(1)
  ).at(0)
  if (!row) {
    throw new NotFoundError(m.server_entry_not_found())
  }
  return row
}

/**
 * A section's single entry is never unpublished, archived or deleted: the
 * section is disabled or deleted as a whole (`globals.ts`).
 */
function assertCollectionEntry(target: { kind: ContentKind }) {
  if (target.kind === 'global') {
    throw new ValidationError([
      {
        path: '',
        message:
          'Site content cannot be unpublished, archived or deleted as an entry. Disable or delete the section instead.',
      },
    ])
  }
}

function importEntryImages(
  ctx: {
    site: typeof site.$inferSelect
    collection: typeof collection.$inferSelect
  },
  data: EntryData,
  actorId: string,
) {
  return importExternalImages({
    organizationId: ctx.site.organizationId,
    originSiteId: ctx.site.id,
    actorId,
    fields: ctx.collection.fields,
    data,
  })
}
