import { randomUUID } from 'node:crypto'
import { and, desc, eq, ilike, inArray, isNotNull, or, sql } from 'drizzle-orm'

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
  localeStatus,
  normalizeBase,
  readLocale,
} from '#/lib/content-locale'
import { SEO_KEY } from '#/lib/seo'
import { m } from '#/paraglide/messages'
import { audit } from '#/server/audit'
import { importExternalImages } from '#/server/assets/external-images'
import { assetMutationLock } from '#/server/assets/usage'

import { archiveDeletedContent } from './deletion-archive'
import { getCollection } from './collections.ts'
import { ConflictError, NotFoundError, ValidationError } from './errors.ts'
import { assertSectionSeo, sectionSeoIssue } from './globals.ts'
import {
  formatLanguageBlockers,
  languageBlockers,
  localeCtxFor,
  toLanguageBlockerDetail,
  validateLocaleSlugs,
} from './locale-validation.ts'
import {
  resolveSlug,
  SLUG_PATTERN,
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
function normalizeEntryData(
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
function prepareReadyData(
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

export async function listEntries(
  siteId: string,
  collectionKey: string,
  options: {
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
  } = {},
) {
  const col = await getCollection(siteId, collectionKey)
  if (!col) {
    throw new NotFoundError(m.server_collection_not_found())
  }

  const limit = options.limit ?? 50
  const offset = options.offset ?? 0
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

  if (options.missingLanguage) {
    const siteRow = (
      await db
        .select({ languages: site.languages })
        .from(site)
        .where(eq(site.id, siteId))
        .limit(1)
    ).at(0)
    const languages = siteRow?.languages
    if (languages?.all.includes(options.missingLanguage)) {
      // Completeness is computed from the draft JSON (required translatable
      // fields, with the same rules as validation), so the matching ids are
      // collected first and then filtered in SQL. Keeps paging and `total`
      // exact. Cost grows with the collection size; only paid when the
      // filter is on.
      const ctx = {
        main: languages.main,
        all: languages.all,
        fields: col.fields,
      }
      const candidates = await db
        .select({ id: entry.id, draftData: entry.draftData })
        .from(entry)
        .where(and(...filters))
      const missing = candidates
        .filter(
          (row) =>
            !localeStatus(row.draftData, options.missingLanguage!, ctx)
              .complete,
        )
        .map((row) => row.id)
      if (missing.length === 0) return { items: [], total: 0 }
      filters.push(inArray(entry.id, missing))
    }
  }

  const where = and(...filters)
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

  const totalRow = (await db
    .select({ count: sql<number>`count(*)::int` })
    .from(entry)
    .where(where)).at(0)

  return { items, total: totalRow?.count ?? 0 }
}

export async function getEntry(id: string) {
  const row = (await db
    .select({
      entry,
      collectionKey: collection.key,
    })
    .from(entry)
    .innerJoin(collection, eq(entry.collectionId, collection.id))
    .where(eq(entry.id, id))
    .limit(1)).at(0)
  if (!row) return null
  return { ...row.entry, collectionKey: row.collectionKey }
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
  const parsed = { ...validated, data: images.data }

  const slug = resolveSlug(parsed.data, ctx.collection.fields)
  if (!slug || !SLUG_PATTERN.test(slug)) {
    throw new ValidationError([
      { path: 'slug', message: m.server_valid_slug_required() },
    ])
  }

  await assertSlugAvailable(ctx.collection.id, slug)

  return db.transaction(async (tx) => {
    await assetMutationLock(tx, ctx.site.organizationId)
    const ownershipErrors = await validateContentOwnership(
      ctx.site.id,
      ctx.site.organizationId,
      ctx.collection.fields,
      parsed.data,
      tx,
    )
    if (ownershipErrors.length) throw new ValidationError(ownershipErrors)
    const now = new Date()
    const created = (await tx
      .insert(entry)
      .values({
        siteId: input.siteId,
        collectionId: ctx.collection.id,
        slug,
        status: 'draft',
        draftData: parsed.data,
        createdBy: input.actorId,
        updatedBy: input.actorId,
        createdAt: now,
        updatedAt: now,
      })
      .returning()).at(0)

    if (!created) {
      throw new Error(m.server_failed_to_create_entry())
    }

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
) {
  const ctx = await loadEntryContext(id)
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
  const parsed = { ...validated, data: images.data }

  const nextSlug = resolveSlug(parsed.data, ctx.collection.fields)
  if (nextSlug && nextSlug !== ctx.entry.slug) {
    if (!SLUG_PATTERN.test(nextSlug)) {
      throw new ValidationError([
        { path: 'slug', message: m.server_invalid_slug() },
      ])
    }
    await assertSlugAvailable(ctx.collection.id, nextSlug, id)
  }

  return db.transaction(async (tx) => {
    await assetMutationLock(tx, ctx.site.organizationId)
    const ownershipErrors = await validateContentOwnership(
      ctx.site.id,
      ctx.site.organizationId,
      ctx.collection.fields,
      parsed.data,
      tx,
    )
    if (ownershipErrors.length) throw new ValidationError(ownershipErrors)
    const now = new Date()
    const updated = (await tx
      .update(entry)
      .set({
        draftVersion: sql`${entry.draftVersion} + 1`,
        draftData: parsed.data,
        slug: nextSlug ?? ctx.entry.slug,
        updatedBy: actorId,
        updatedAt: now,
      })
      .where(and(eq(entry.id, id), eq(entry.draftVersion, expectedVersion)))
      .returning()).at(0)

    if (!updated) {
      throw new ConflictError(
        'DRAFT_CONFLICT: This entry changed on the server. Reload or explicitly reapply your recovered draft.',
      )
    }

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
    )

    return {
      ...updated,
      collectionKey: ctx.collection.key,
      importedImages: images.imported,
      importWarnings: images.warnings,
    }
  })
}

export async function listRevisions(entryId: string) {
  const existing = await getEntry(entryId)
  if (!existing) {
    throw new NotFoundError(m.server_entry_not_found())
  }
  return db
    .select()
    .from(entryRevision)
    .where(eq(entryRevision.entryId, entryId))
    .orderBy(desc(entryRevision.createdAt))
}

export async function restoreRevision(
  entryId: string,
  revisionId: string,
  actorId: string,
  expectedVersion: number,
) {
  const initial = await loadEntryContext(entryId)
  const revision = (await db
    .select()
    .from(entryRevision)
    .where(
      and(eq(entryRevision.id, revisionId), eq(entryRevision.entryId, entryId)),
    )
    .limit(1)).at(0)
  if (!revision) {
    throw new NotFoundError(m.server_revision_not_found())
  }

  return db.transaction(async (tx) => {
    await tx
      .select({ id: site.id })
      .from(site)
      .where(eq(site.id, initial.site.id))
      .for('update')
    const ctx = await loadEntryContext(entryId, tx)
    await assetMutationLock(tx, ctx.site.organizationId)
    const prepared = prepareRevisionRestore(
      ctx.collection.fields,
      revision.data,
      ctx.entry.draftData,
    )
    const restoredData = prepared.data
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
    const updated = (await tx
      .update(entry)
      .set({
        draftVersion: sql`${entry.draftVersion} + 1`,
        draftData: restoredData,
        slug: nextSlug ?? ctx.entry.slug,
        updatedBy: actorId,
        updatedAt: now,
      })
      .where(
        and(eq(entry.id, entryId), eq(entry.draftVersion, expectedVersion)),
      )
      .returning()).at(0)

    if (!updated) {
      throw new ConflictError(
        'DRAFT_CONFLICT: This entry changed on the server.',
      )
    }

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

export async function publishEntry(id: string, actorId: string) {
  const ctx = await loadEntryContext(id)
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
    await assetMutationLock(tx, ctx.site.organizationId)
    const ownershipErrors = await validateContentOwnership(
      ctx.site.id,
      ctx.site.organizationId,
      ctx.collection.fields,
      draftData,
      tx,
    )
    if (ownershipErrors.length) throw new ValidationError(ownershipErrors)
    const now = new Date()
    const updated = (await tx
      .update(entry)
      .set({
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
      .where(
        and(eq(entry.id, id), eq(entry.draftVersion, ctx.entry.draftVersion)),
      )
      .returning()).at(0)

    if (!updated) {
      throw new ConflictError(
        'DRAFT_CONFLICT: Draft changed while approving. Reload and review it.',
      )
    }

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
  const updated = (await db
    .update(entry)
    .set({
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
    .returning()).at(0)

  if (!updated) {
    throw new NotFoundError(m.server_entry_not_found())
  }

  await writeRevision(id, ctx.entry.draftData, actorId, 'unpublish')
  await audit({
    organizationId: ctx.site.organizationId,
    siteId: ctx.site.id,
    actorId,
    action: 'entry.unpublish',
    targetType: 'entry',
    targetId: id,
  })

  return { ...updated, collectionKey: ctx.collection.key }
}

export async function archiveEntry(id: string, actorId: string) {
  const ctx = await loadEntryContext(id)
  assertCollectionEntry(ctx.collection)
  const now = new Date()
  const updated = (await db
    .update(entry)
    .set({
      status: 'archived',
      updatedBy: actorId,
      updatedAt: now,
    })
    .where(eq(entry.id, id))
    .returning()).at(0)

  if (!updated) {
    throw new NotFoundError(m.server_entry_not_found())
  }

  await writeRevision(id, ctx.entry.draftData, actorId, 'archive')
  await audit({
    organizationId: ctx.site.organizationId,
    siteId: ctx.site.id,
    actorId,
    action: 'entry.archive',
    targetType: 'entry',
    targetId: id,
  })

  return { ...updated, collectionKey: ctx.collection.key }
}

export async function scheduleEntry(
  id: string,
  scheduledAt: string,
  timezone: string,
  actorId: string,
) {
  const ctx = await loadEntryContext(id)
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
    await assetMutationLock(tx, ctx.site.organizationId)
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
    const updated = (await tx
      .update(entry)
      .set({
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
      .where(
        and(eq(entry.id, id), eq(entry.draftVersion, ctx.entry.draftVersion)),
      )
      .returning()).at(0)

    if (!updated) {
      throw new ConflictError(
        'DRAFT_CONFLICT: Draft changed while approving. Reload and review it.',
      )
    }

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
  const updated = (await db
    .update(entry)
    .set({
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
    .returning()).at(0)

  if (!updated) {
    throw new NotFoundError(m.server_entry_not_found())
  }

  await writeRevision(id, ctx.entry.draftData, actorId, 'cancel_schedule')
  await audit({
    organizationId: ctx.site.organizationId,
    siteId: ctx.site.id,
    actorId,
    action: 'entry.cancel_schedule',
    targetType: 'entry',
    targetId: id,
  })

  return { ...updated, collectionKey: ctx.collection.key }
}

export async function deleteEntry(id: string, actorId: string) {
  const ctx = await loadEntryContext(id)
  assertCollectionEntry(ctx.collection)
  return db.transaction(async (tx) => {
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
    )
    await tx.delete(entry).where(eq(entry.id, id))
  })
}

async function writeRevision(
  entryId: string,
  data: EntryData,
  actorId: string,
  note: string,
  connection: Pick<typeof db, 'insert'> = db,
) {
  await connection.insert(entryRevision).values({
    entryId,
    data,
    createdBy: actorId,
    note,
  })
}

async function assertSlugAvailable(
  collectionId: string,
  slug: string,
  excludeId?: string,
  connection: Pick<typeof db, 'select'> = db,
) {
  const existing = (await connection
    .select({ id: entry.id })
    .from(entry)
    .where(and(eq(entry.collectionId, collectionId), eq(entry.slug, slug)))
    .limit(1)).at(0)
  if (existing && existing.id !== excludeId) {
    throw new ConflictError(m.server_slug_already_exists())
  }
}

async function loadCollectionContext(siteId: string, collectionKey: string) {
  const row = (await db
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
    .limit(1)).at(0)
  if (!row) {
    throw new NotFoundError(m.server_collection_not_found())
  }
  return row
}

async function loadEntryContext(
  id: string,
  connection: Pick<typeof db, 'select'> = db,
) {
  const row = (await connection
    .select({ entry, collection, site })
    .from(entry)
    .innerJoin(collection, eq(entry.collectionId, collection.id))
    .innerJoin(site, eq(entry.siteId, site.id))
    .where(eq(entry.id, id))
    .limit(1)).at(0)
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
