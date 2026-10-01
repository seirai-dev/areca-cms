import { randomUUID } from 'node:crypto'
import { and, desc, eq, ilike, isNotNull, lte, or, sql } from 'drizzle-orm'

import { db } from '#/db'
import { collection, entry, entryRevision, site, user } from '#/db/schema'
import {
  isIanaTimeZone,
  isPastInstant,
  parseOffsetInstant,
} from '#/lib/schedule-time'
import type { EntryData, EntryStatus } from '#/lib/types'
import { m } from '#/paraglide/messages'
import { audit } from '#/server/audit'
import { assetMutationLock } from '#/server/assets/usage'

import { archiveDeletedContent } from './deletion-archive'
import { getCollection } from './collections.ts'
import { ConflictError, NotFoundError, ValidationError } from './errors.ts'
import {
  resolveSlug,
  SLUG_PATTERN,
  pickDeclaredFields,
  validateEntryData,
  validateReferences,
  validateContentOwnership,
} from './validation.ts'

export async function listEntries(
  siteId: string,
  collectionKey: string,
  options: {
    status?: EntryStatus
    /** Eligible snapshot/publish targets only; do not combine with `status`. */
    referenceTargets?: boolean
    search?: string
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
    const now = new Date()
    filters.push(
      or(
        eq(entry.status, 'published'),
        and(
          eq(entry.status, 'scheduled'),
          or(isNotNull(entry.publishedData), isNotNull(entry.publishedSlug))!,
        ),
        and(
          eq(entry.status, 'scheduled'),
          isNotNull(entry.scheduledAt),
          lte(entry.scheduledAt, now),
        ),
      )!,
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

  const [totalRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(entry)
    .where(where)

  return { items, total: totalRow?.count ?? 0 }
}

export async function getEntry(id: string) {
  const [row] = await db
    .select({
      entry,
      collectionKey: collection.key,
    })
    .from(entry)
    .innerJoin(collection, eq(entry.collectionId, collection.id))
    .where(eq(entry.id, id))
    .limit(1)
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

  const parsed = validateEntryData(ctx.collection.fields, input.data, {
    mode: 'partial',
    write: true,
  })
  if (!parsed.ok) {
    throw new ValidationError(parsed.errors)
  }

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
    const [created] = await tx
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
      .returning()

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

    return { ...created, collectionKey: ctx.collection.key }
  })
}

export async function updateDraft(
  id: string,
  data: EntryData,
  actorId: string,
  expectedVersion: number,
) {
  const ctx = await loadEntryContext(id)
  const parsed = validateEntryData(ctx.collection.fields, data, {
    mode: 'partial',
    write: true,
  })
  if (!parsed.ok) {
    throw new ValidationError(parsed.errors)
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
    const [updated] = await tx
      .update(entry)
      .set({
        draftVersion: sql`${entry.draftVersion} + 1`,
        draftData: parsed.data,
        slug: nextSlug ?? ctx.entry.slug,
        updatedBy: actorId,
        updatedAt: now,
      })
      .where(and(eq(entry.id, id), eq(entry.draftVersion, expectedVersion)))
      .returning()

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

    return { ...updated, collectionKey: ctx.collection.key }
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
  const ctx = await loadEntryContext(entryId)
  const [revision] = await db
    .select()
    .from(entryRevision)
    .where(
      and(eq(entryRevision.id, revisionId), eq(entryRevision.entryId, entryId)),
    )
    .limit(1)
  if (!revision) {
    throw new NotFoundError(m.server_revision_not_found())
  }

  // Drop keys the schema no longer declares so legacy data does not return.
  const restoredData = pickDeclaredFields(ctx.collection.fields, revision.data)

  const nextSlug = resolveSlug(restoredData, ctx.collection.fields)
  if (nextSlug && nextSlug !== ctx.entry.slug) {
    await assertSlugAvailable(ctx.collection.id, nextSlug, entryId)
  }

  return db.transaction(async (tx) => {
    await assetMutationLock(tx, ctx.site.organizationId)
    const ownershipErrors = await validateContentOwnership(
      ctx.site.id,
      ctx.site.organizationId,
      ctx.collection.fields,
      restoredData,
      tx,
    )
    if (ownershipErrors.length) throw new ValidationError(ownershipErrors)
    const now = new Date()
    const [updated] = await tx
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
      .returning()

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

    return { ...updated, collectionKey: ctx.collection.key }
  })
}

export async function publishEntry(id: string, actorId: string) {
  const ctx = await loadEntryContext(id)
  const parsed = validateEntryData(ctx.collection.fields, ctx.entry.draftData)
  if (!parsed.ok) {
    throw new ValidationError(parsed.errors)
  }
  const refErrors = await validateReferences(
    ctx.site.id,
    ctx.collection.fields,
    ctx.entry.draftData,
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
      ctx.entry.draftData,
      tx,
    )
    if (ownershipErrors.length) throw new ValidationError(ownershipErrors)
    const now = new Date()
    const [updated] = await tx
      .update(entry)
      .set({
        status: 'published',
        publishedData: parsed.data,
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
      .returning()

    if (!updated) {
      throw new ConflictError(
        'DRAFT_CONFLICT: Draft changed while approving. Reload and review it.',
      )
    }

    await writeRevision(id, ctx.entry.draftData, actorId, 'publish', tx)
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

    return { ...updated, collectionKey: ctx.collection.key }
  })
}

export async function unpublishEntry(id: string, actorId: string) {
  const ctx = await loadEntryContext(id)
  const now = new Date()
  const [updated] = await db
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
    .returning()

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
  const now = new Date()
  const [updated] = await db
    .update(entry)
    .set({
      status: 'archived',
      updatedBy: actorId,
      updatedAt: now,
    })
    .where(eq(entry.id, id))
    .returning()

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

  return db.transaction(async (tx) => {
    await assetMutationLock(tx, ctx.site.organizationId)
    const ownershipErrors = await validateContentOwnership(
      ctx.site.id,
      ctx.site.organizationId,
      ctx.collection.fields,
      ctx.entry.draftData,
      tx,
    )
    if (ownershipErrors.length) throw new ValidationError(ownershipErrors)
    const validated = validateEntryData(
      ctx.collection.fields,
      ctx.entry.draftData,
    )
    if (!validated.ok) throw new ValidationError(validated.errors)
    const now = new Date()
    const [updated] = await tx
      .update(entry)
      .set({
        status: 'scheduled',
        scheduledData: validated.data,
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
      .returning()

    if (!updated) {
      throw new ConflictError(
        'DRAFT_CONFLICT: Draft changed while approving. Reload and review it.',
      )
    }

    await writeRevision(id, ctx.entry.draftData, actorId, 'schedule', tx)
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

    return { ...updated, collectionKey: ctx.collection.key }
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
  const [updated] = await db
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
    .returning()

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
) {
  const [existing] = await db
    .select({ id: entry.id })
    .from(entry)
    .where(and(eq(entry.collectionId, collectionId), eq(entry.slug, slug)))
    .limit(1)
  if (existing && existing.id !== excludeId) {
    throw new ConflictError(m.server_slug_already_exists())
  }
}

async function loadCollectionContext(siteId: string, collectionKey: string) {
  const [row] = await db
    .select({ collection, site })
    .from(collection)
    .innerJoin(site, eq(collection.siteId, site.id))
    .where(
      and(eq(collection.siteId, siteId), eq(collection.key, collectionKey)),
    )
    .limit(1)
  if (!row) {
    throw new NotFoundError(m.server_collection_not_found())
  }
  return row
}

async function loadEntryContext(id: string) {
  const [row] = await db
    .select({ entry, collection, site })
    .from(entry)
    .innerJoin(collection, eq(entry.collectionId, collection.id))
    .innerJoin(site, eq(entry.siteId, site.id))
    .where(eq(entry.id, id))
    .limit(1)
  if (!row) {
    throw new NotFoundError(m.server_entry_not_found())
  }
  return row
}
