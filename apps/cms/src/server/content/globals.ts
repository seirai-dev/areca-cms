import { and, asc, eq, sql } from 'drizzle-orm'

import { db } from '#/db'
import { collection, entry, entryRevision, site } from '#/db/schema'
import { GLOBAL_ENTRY_SLUG } from '#/lib/globals'
import { I18N_KEY } from '#/lib/content-locale'
import { SEO_KEY } from '#/lib/seo'
import type { EntryData, Field } from '#/lib/types'
import { m } from '#/paraglide/messages'
import { audit } from '#/server/audit'

import { archiveDeletedContent } from './deletion-archive'
import {
  assertKindsUnchanged,
  assertPreviewPath,
  validateContentDefinitions,
} from './content-definitions.ts'
import { ConflictError, NotFoundError, ValidationError } from './errors.ts'
import { confirmedFieldDrops, purgeFieldContent } from './field-data.ts'
import {
  formatLanguageBlockers,
  languageBlockers,
  normalizeRequiredLanguages,
} from './locale-validation.ts'

/**
 * Site content sections ("globals"). A section is a `collection` row with
 * kind 'global' and exactly one entry, slug `$global`. Entry status rules,
 * revisions and scheduling are the entry rules; these functions only add the
 * single-instance shape, the discard, and the section lifecycle.
 */

export type GlobalInput = {
  key: string
  label: string
  fields: Field[]
  /** Keys of fields that are removed together with their content. */
  confirmDropFields?: string[]
  seo?: boolean
  previewPath?: string | null
  enabled?: boolean
  /** Languages besides main that must be complete before going live. */
  requiredLanguages?: string[]
}

/**
 * SEO is opt-in per section. A section without it cannot store `$seo`, whether
 * the write comes from the editor, the API or an AI tool. Null means "no SEO".
 */
export function sectionSeoIssue(
  global: { label: string; seoEnabled: boolean },
  data: Record<string, unknown>,
): string | null {
  if (global.seoEnabled || !hasAnySeo(data)) return null
  return `${global.label} has no SEO. Only sections with SEO turned on can save seo; an agency admin can turn it on.`
}

/** `$seo` in the base or in any language slot. */
function hasAnySeo(data: Record<string, unknown>): boolean {
  if (data[SEO_KEY] != null) return true
  const translations = data[I18N_KEY]
  if (!translations || typeof translations !== 'object') return false
  return Object.values(translations).some(
    (slot) =>
      slot !== null &&
      typeof slot === 'object' &&
      (slot as Record<string, unknown>)[SEO_KEY] != null,
  )
}

/**
 * Draft data without `$seo`, in the base and in every `$i18n.<locale>` slot.
 * A slot left empty by that is dropped.
 */
function withoutSeoEverywhere(data: EntryData): EntryData {
  const { [SEO_KEY]: _seo, ...rest } = data
  const translations = data[I18N_KEY]
  if (!translations || typeof translations !== 'object') return rest
  const next: Record<string, EntryData> = {}
  for (const [locale, slot] of Object.entries(translations)) {
    if (slot === null || typeof slot !== 'object' || Array.isArray(slot)) {
      next[locale] = slot as EntryData
      continue
    }
    const { [SEO_KEY]: _slotSeo, ...slotRest } = slot as EntryData
    if (Object.keys(slotRest).length > 0) next[locale] = slotRest
  }
  if (Object.keys(next).length > 0) rest[I18N_KEY] = next
  return rest
}

export function assertSectionSeo(
  global: { label: string; seoEnabled: boolean },
  data: Record<string, unknown>,
) {
  const message = sectionSeoIssue(global, data)
  if (message) throw new ValidationError([{ path: SEO_KEY, message }])
}

export async function getGlobal(
  siteId: string,
  key: string,
  connection: Pick<typeof db, 'select'> = db,
) {
  const row = (
    await connection
      .select()
      .from(collection)
      .where(
        and(
          eq(collection.siteId, siteId),
          eq(collection.key, key),
          eq(collection.kind, 'global'),
        ),
      )
      .limit(1)
  ).at(0)
  return row ?? null
}

/**
 * True when the row is an entry of a disabled section and the viewer is not an
 * agency admin. Such entries answer NotFound by id, as the section does by key.
 */
export async function isHiddenSectionEntry(
  collectionId: string,
  viewerIsAgency: boolean,
  connection: Pick<typeof db, 'select'> = db,
) {
  if (viewerIsAgency) return false
  const row = (
    await connection
      .select({ enabled: collection.enabled })
      .from(collection)
      .where(
        and(eq(collection.id, collectionId), eq(collection.kind, 'global')),
      )
      .limit(1)
  ).at(0)
  return row !== undefined && !row.enabled
}

export async function listGlobals(
  siteId: string,
  options: { enabledOnly?: boolean } = {},
  connection: Pick<typeof db, 'select'> = db,
) {
  const filters = [eq(collection.siteId, siteId), eq(collection.kind, 'global')]
  if (options.enabledOnly) {
    filters.push(eq(collection.enabled, true))
  }
  return connection
    .select()
    .from(collection)
    .where(and(...filters))
    .orderBy(asc(collection.key))
}

/** The section and its one `$global` entry, or null when there is no such section. */
export async function getGlobalEntry(siteId: string, key: string) {
  const global = await getGlobal(siteId, key)
  if (!global) return null
  const row = (
    await db
      .select()
      .from(entry)
      .where(
        and(
          eq(entry.collectionId, global.id),
          eq(entry.slug, GLOBAL_ENTRY_SLUG),
        ),
      )
      .limit(1)
  ).at(0)
  if (!row) return null
  return { global, entry: row }
}

/**
 * Creates the section's single entry if it is missing. Runs inside the
 * transaction that writes the section row, so the two never diverge.
 */
export async function ensureGlobalEntry(
  tx: Pick<typeof db, 'select' | 'insert'>,
  siteId: string,
  globalId: string,
) {
  const existing = (
    await tx
      .select({ id: entry.id })
      .from(entry)
      .where(
        and(
          eq(entry.collectionId, globalId),
          eq(entry.slug, GLOBAL_ENTRY_SLUG),
        ),
      )
      .limit(1)
  ).at(0)
  if (existing) return
  await tx.insert(entry).values({
    siteId,
    collectionId: globalId,
    slug: GLOBAL_ENTRY_SLUG,
    status: 'draft',
  })
}

export async function upsertGlobal(
  siteId: string,
  input: GlobalInput,
  actorId?: string,
) {
  const label = input.label.trim()
  if (!label) {
    throw new ValidationError([{ path: 'label', message: m.server_required() }])
  }
  const invalidField = input.fields.find(
    (field) => !field.key.trim() || !field.label.trim(),
  )
  if (invalidField) {
    throw new ValidationError([
      {
        path: `fields.${input.fields.indexOf(invalidField)}`,
        message: m.server_required(),
      },
    ])
  }
  const previewPath = input.previewPath || null
  assertPreviewPath(previewPath, input.key)
  const existingSite = (
    await db.select().from(site).where(eq(site.id, siteId)).limit(1)
  ).at(0)
  if (!existingSite) {
    throw new NotFoundError(m.server_site_not_found())
  }

  const now = new Date()
  const enabled = input.enabled ?? true
  const seoEnabled = input.seo ?? false
  const requiredLanguages =
    input.requiredLanguages === undefined
      ? undefined
      : normalizeRequiredLanguages(input.requiredLanguages)

  await db.transaction(async (tx) => {
    await tx
      .select({ id: site.id })
      .from(site)
      .where(eq(site.id, siteId))
      .for('update')
    const existing = await tx
      .select()
      .from(collection)
      .where(eq(collection.siteId, siteId))
    assertKindsUnchanged(existing, [{ key: input.key, kind: 'global' }])
    const previous = existing.find(
      (row) => row.key === input.key && row.kind === 'global',
    )
    validateContentDefinitions([
      ...existing.filter((row) => row.key !== input.key),
      { key: input.key, kind: 'global', fields: input.fields, enabled },
    ])
    const purgedKeys = await confirmedFieldDrops(tx, {
      collectionId: previous?.id,
      before: previous?.fields ?? [],
      after: input.fields,
      confirmDropFields: input.confirmDropFields,
    })
    const row = (
      await tx
        .insert(collection)
        .values({
          siteId,
          key: input.key,
          label,
          routePattern: '',
          kind: 'global',
          fields: input.fields,
          enabled,
          seoEnabled,
          previewPath,
          requiredLanguages: requiredLanguages ?? [],
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [collection.siteId, collection.key],
          set: {
            label,
            fields: input.fields,
            enabled,
            seoEnabled,
            previewPath,
            ...(requiredLanguages !== undefined ? { requiredLanguages } : {}),
            updatedAt: now,
          },
        })
        .returning({ id: collection.id })
    ).at(0)
    if (!row) {
      throw new Error(m.server_failed_to_upsert_collection())
    }
    if (previous) await purgeFieldContent(tx, previous.id, purgedKeys)
    await ensureGlobalEntry(tx, siteId, row.id)
    // Turning SEO off must not leave stale SEO in the draft for a later ready.
    // Ready and scheduled data are stripped when the snapshot is built.
    if (previous?.seoEnabled && !seoEnabled) {
      const [draft] = await tx
        .select({ draftData: entry.draftData })
        .from(entry)
        .where(
          and(
            eq(entry.collectionId, row.id),
            eq(entry.slug, GLOBAL_ENTRY_SLUG),
          ),
        )
        .limit(1)
      await tx
        .update(entry)
        .set({
          draftData: withoutSeoEverywhere(draft.draftData),
          draftVersion: sql`${entry.draftVersion} + 1`,
          updatedAt: now,
        })
        .where(
          and(
            eq(entry.collectionId, row.id),
            eq(entry.slug, GLOBAL_ENTRY_SLUG),
          ),
        )
    }
  })

  const row = await getGlobal(siteId, input.key)
  if (!row) {
    throw new Error(m.server_failed_to_upsert_collection())
  }

  await audit({
    organizationId: existingSite.organizationId,
    siteId,
    actorId,
    action: 'global.upsert',
    targetType: 'collection',
    targetId: row.id,
    meta: { key: input.key, kind: 'global' },
  })

  return row
}

export async function setGlobalEnabled(
  siteId: string,
  key: string,
  enabled: boolean,
  actorId: string,
) {
  const existing = await getGlobal(siteId, key)
  if (!existing) {
    throw new NotFoundError(m.server_not_found())
  }
  const organizationId = await siteOrganizationId(siteId)
  const now = new Date()

  await db.transaction(async (tx) => {
    await tx
      .select({ id: site.id })
      .from(site)
      .where(eq(site.id, siteId))
      .for('update')
    const rows = await tx
      .select()
      .from(collection)
      .where(eq(collection.siteId, siteId))
    validateContentDefinitions(
      rows.map((row) => (row.id === existing.id ? { ...row, enabled } : row)),
    )
    await tx
      .update(collection)
      .set({ enabled, updatedAt: now })
      .where(eq(collection.id, existing.id))
  })

  await audit({
    organizationId,
    siteId,
    actorId,
    action: 'global.set_enabled',
    targetType: 'collection',
    targetId: existing.id,
    meta: { key, label: existing.label, enabled },
  })

  const updated = await getGlobal(siteId, key)
  if (!updated) {
    throw new NotFoundError(m.server_not_found())
  }
  return updated
}

export async function deleteGlobal(
  siteId: string,
  key: string,
  actorId: string,
) {
  const existing = (
    await db
      .select({
        id: collection.id,
        organizationId: site.organizationId,
      })
      .from(collection)
      .innerJoin(site, eq(collection.siteId, site.id))
      .where(
        and(
          eq(collection.siteId, siteId),
          eq(collection.key, key),
          eq(collection.kind, 'global'),
        ),
      )
      .limit(1)
  ).at(0)
  if (!existing) {
    throw new NotFoundError(m.server_not_found())
  }

  await db.transaction(async (tx) => {
    await tx
      .select({ id: site.id })
      .from(site)
      .where(eq(site.id, siteId))
      .for('update')
    await archiveDeletedContent(
      tx,
      existing.organizationId,
      'collection',
      existing.id,
    )
    await tx.delete(collection).where(eq(collection.id, existing.id))
    await audit(
      {
        organizationId: existing.organizationId,
        siteId,
        actorId,
        action: 'global.delete',
        targetType: 'collection',
        targetId: existing.id,
        meta: { key, kind: 'global' },
      },
      tx,
    )
  })
}

/**
 * Resets the draft to the last ready version: the scheduled data while a
 * change is scheduled, otherwise the published data. Refused until the
 * section has been marked ready at least once.
 */
async function siteOrganizationId(siteId: string) {
  const row = (
    await db
      .select({ organizationId: site.organizationId })
      .from(site)
      .where(eq(site.id, siteId))
      .limit(1)
  ).at(0)
  if (!row) {
    throw new NotFoundError(m.server_site_not_found())
  }
  return row.organizationId
}

export async function discardGlobalDraft(
  siteId: string,
  key: string,
  actorId: string,
) {
  const found = await getGlobalEntry(siteId, key)
  if (!found) {
    throw new NotFoundError(m.server_not_found())
  }
  const organizationId = await siteOrganizationId(siteId)

  return db.transaction(async (tx) => {
    await tx
      .select({ id: site.id })
      .from(site)
      .where(eq(site.id, siteId))
      .for('update')
    const current = (
      await tx
        .select()
        .from(entry)
        .where(eq(entry.id, found.entry.id))
        .for('update')
        .limit(1)
    ).at(0)
    if (!current) {
      throw new NotFoundError(m.server_not_found())
    }
    const ready: EntryData | null =
      current.status === 'scheduled'
        ? current.scheduledData
        : current.status === 'published'
          ? current.publishedData
          : null
    if (ready == null) {
      throw new ConflictError(
        'This site content has never been marked ready, so there is no ready version to discard to.',
      )
    }

    const now = new Date()
    const updated = (
      await tx
        .update(entry)
        .set({
          draftData: ready,
          draftVersion: sql`${entry.draftVersion} + 1`,
          updatedBy: actorId,
          updatedAt: now,
        })
        .where(eq(entry.id, current.id))
        .returning()
    ).at(0)
    if (!updated) {
      throw new ConflictError(
        'DRAFT_CONFLICT: This site content changed on the server.',
      )
    }

    await tx.insert(entryRevision).values({
      entryId: current.id,
      data: ready,
      createdBy: actorId,
      note: 'discard',
    })
    await audit(
      {
        organizationId,
        siteId,
        actorId,
        action: 'entry.discard',
        targetType: 'entry',
        targetId: current.id,
        meta: { key },
      },
      tx,
    )

    return updated
  })
}

/**
 * Messages for enabled sections that block going live: a section with required
 * fields that has never been made ready (or whose scheduled version is due but
 * empty). Same rule as the snapshot; kept light enough for the release status.
 */
export async function sectionBlockers(
  siteId: string,
  connection: Pick<typeof db, 'select'> = db,
): Promise<string[]> {
  const rows = await connection
    .select({
      label: collection.label,
      fields: collection.fields,
      requiredLanguages: collection.requiredLanguages,
      languages: site.languages,
      status: entry.status,
      scheduledAt: entry.scheduledAt,
      publishedData: entry.publishedData,
      scheduledData: entry.scheduledData,
    })
    .from(collection)
    .innerJoin(entry, eq(entry.collectionId, collection.id))
    .innerJoin(site, eq(site.id, collection.siteId))
    .where(
      and(
        eq(collection.siteId, siteId),
        eq(collection.kind, 'global'),
        eq(collection.enabled, true),
      ),
    )
  const now = new Date()
  return rows.flatMap((row) => {
    if (!row.fields.some((field) => field.required)) return []
    const due =
      row.status === 'scheduled' &&
      row.scheduledAt != null &&
      row.scheduledAt <= now
    const data =
      row.status === 'draft'
        ? null
        : due
          ? row.scheduledData
          : row.publishedData
    if (data == null) {
      return [
        `Site content "${row.label}" has required fields and has never been marked ready.`,
      ]
    }
    // The ready version must be complete in the main language and every required language.
    const gaps = languageBlockers({
      data,
      fields: row.fields,
      languages: row.languages,
      requiredLanguages: row.requiredLanguages,
    })
    if (gaps.length === 0) return []
    return [`Site content "${row.label}": ${formatLanguageBlockers(gaps)}`]
  })
}
