import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'

import { entry } from '#/db/schema'
import {
  isIanaTimeZone,
  isPastInstant,
  parseOffsetInstant,
} from '#/lib/schedule-time'
import { m } from '#/paraglide/messages'
import { audit } from '#/server/audit'
import { assetAttachLock } from '#/server/assets/usage'
import { isDevSite } from '#/server/security/site-visibility'

import { archiveDeletedContent } from './deletion-archive'
import {
  CLEARED_SCHEDULE,
  assertContentOwnership,
  entryTransaction,
  recordEntryChange,
  updateEntryRow,
} from './entry-commit.ts'
import {
  assertCollectionEntry,
  importEntryImages,
  importReport,
  loadEntryContext,
  normalizeEntryData,
  prepareReadyData,
} from './entry-context.ts'
import { ConflictError, ValidationError } from './errors.ts'
import { validateReferences } from './validation.ts'

/** The workflow of an entry: mark ready, take back, archive, schedule, delete. */

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

  return entryTransaction(ctx.site.id, async (tx) => {
    await assetAttachLock(tx, ctx.site.organizationId)
    await assertContentOwnership(tx, ctx.site, ctx.collection.fields, draftData)
    const now = new Date()
    const updated = await updateEntryRow(
      tx,
      id,
      {
        ...(images.imported > 0 || draftData !== images.data
          ? { draftData }
          : {}),
        status: 'published',
        publishedData: ready.stored,
        publishedSlug: ctx.entry.slug,
        publishedAt: now,
        ...CLEARED_SCHEDULE,
        updatedBy: actorId,
        updatedAt: now,
      },
      { draftVersion: reviewed, conflict: APPROVAL_CONFLICT_MESSAGE },
    )
    await recordEntryChange(tx, ctx.site, {
      entryId: id,
      actorId,
      note: 'publish',
      data: draftData,
    })
    return {
      ...updated,
      collectionKey: ctx.collection.key,
      ...importReport(images),
    }
  })
}

export async function unpublishEntry(id: string, actorId: string) {
  const ctx = await loadEntryContext(id)
  assertCollectionEntry(ctx.collection)
  const now = new Date()
  return entryTransaction(ctx.site.id, async (tx) => {
    const updated = await updateEntryRow(tx, id, {
      status: 'draft',
      publishedData: null,
      publishedSlug: null,
      publishedAt: null,
      ...CLEARED_SCHEDULE,
      updatedBy: actorId,
      updatedAt: now,
    })
    await recordEntryChange(tx, ctx.site, {
      entryId: id,
      actorId,
      note: 'unpublish',
      data: ctx.entry.draftData,
    })
    return { ...updated, collectionKey: ctx.collection.key }
  })
}

export async function archiveEntry(id: string, actorId: string) {
  const ctx = await loadEntryContext(id)
  assertCollectionEntry(ctx.collection)
  const now = new Date()
  return entryTransaction(ctx.site.id, async (tx) => {
    const updated = await updateEntryRow(tx, id, {
      status: 'archived',
      updatedBy: actorId,
      updatedAt: now,
    })
    await recordEntryChange(tx, ctx.site, {
      entryId: id,
      actorId,
      note: 'archive',
      data: updated.draftData,
    })
    return { ...updated, collectionKey: ctx.collection.key }
  })
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

  return entryTransaction(ctx.site.id, async (tx) => {
    await assetAttachLock(tx, ctx.site.organizationId)
    await assertContentOwnership(tx, ctx.site, ctx.collection.fields, draftData)
    const ready = prepareReadyData(ctx, draftData)
    const updated = await updateEntryRow(
      tx,
      id,
      {
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
        updatedAt: new Date(),
      },
      { draftVersion: reviewed, conflict: APPROVAL_CONFLICT_MESSAGE },
    )
    await recordEntryChange(tx, ctx.site, {
      entryId: id,
      actorId,
      note: 'schedule',
      data: draftData,
      auditMeta: { scheduledAt, timezone },
    })
    return {
      ...updated,
      collectionKey: ctx.collection.key,
      ...importReport(images),
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
  return entryTransaction(ctx.site.id, async (tx) => {
    const updated = await updateEntryRow(tx, id, {
      status: nextStatus,
      ...CLEARED_SCHEDULE,
      updatedBy: actorId,
      updatedAt: now,
    })
    await recordEntryChange(tx, ctx.site, {
      entryId: id,
      actorId,
      note: 'cancel_schedule',
      data: ctx.entry.draftData,
    })
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
  return entryTransaction(ctx.site.id, async (tx) => {
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
