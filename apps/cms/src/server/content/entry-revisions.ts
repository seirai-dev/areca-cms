import { and, desc, eq, sql } from 'drizzle-orm'

import { db } from '#/db'
import { entry, entryRevision, site } from '#/db/schema'
import { I18N_KEY, LOCALE_KEY } from '#/lib/content-locale'
import { SEO_KEY } from '#/lib/seo'
import type { EntryData, Field } from '#/lib/types'
import { m } from '#/paraglide/messages'
import { assetAttachLock } from '#/server/assets/usage'

import {
  entryTransaction,
  recordEntryChange,
  updateEntryRow,
} from './entry-commit.ts'
import { assertSlugAvailable, loadEntryContext } from './entry-context.ts'
import { prepareEntryLinks } from './entry-links.ts'
import { ConflictError, NotFoundError } from './errors.ts'
import { sectionSeoIssue } from './globals.ts'
import { claimedSlugs, lockSlugClaims } from './locale-validation.ts'
import {
  pickDeclaredFields,
  resolveSlug,
  validateContentOwnership,
  validateEntryData,
  validateLanguageData,
} from './validation.ts'

/** An entry's history: the revision list, and restoring one revision. */

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
  const existing = (
    await db
      .select({ id: entry.id })
      .from(entry)
      .where(eq(entry.id, entryId))
      .limit(1)
  ).at(0)
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

  return entryTransaction(initial.site.id, async (tx) => {
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
    const updated = await updateEntryRow(
      tx,
      entryId,
      {
        draftVersion: sql`${entry.draftVersion} + 1`,
        draftData: restoredData,
        slug: nextSlug ?? ctx.entry.slug,
        updatedBy: actorId,
        updatedAt: new Date(),
      },
      {
        draftVersion: expectedVersion,
        conflict: 'DRAFT_CONFLICT: This entry changed on the server.',
      },
    )
    await recordEntryChange(tx, ctx.site, {
      entryId,
      actorId,
      note: 'restore',
      data: restoredData,
      auditMeta: { revisionId },
    })
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
