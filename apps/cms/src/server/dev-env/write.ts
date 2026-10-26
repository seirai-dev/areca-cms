/**
 * Writes shared by a push and a copy to production (docs/design/dev-environments.md,
 * "Push" and "Copy to production"): the draft snapshot kept before a
 * production draft is replaced, slug checks, strict ready validation, reference
 * lookups and the origin baseline a dev entry records. Everything runs inside
 * the caller's transaction, under the production locks.
 */
import { and, eq } from 'drizzle-orm'

import type { collection } from '#/db/schema'
import { entry, entryRevision, site } from '#/db/schema'
import type { EntryData, EntryOriginBaseline, Field } from '#/lib/types'
import { m } from '#/paraglide/messages'
import { prepareReadyData } from '#/server/content/entries'
import { NotFoundError, ValidationError } from '#/server/content/errors'
import { validateReferences } from '#/server/content/validation'

import type { PlanEntry } from './plan'
import { referenceLookup, referenceTargets } from './references'
import type { ReferenceLookup, ReferenceWarning } from './references'
import type { SiteRow, Tx } from './rows'

export type ProductionCollection = typeof collection.$inferSelect

export type PushWarning = {
  /** The plan item the warning is about, when there is one. */
  itemId: string | null
  message: string
  field?: string
  locale?: string
  devTargetId?: string
}

export type PushCounts = {
  schema: number
  new: number
  changed: number
  archived: number
  skipped: number
  warnings: number
}

/** Dev entry fields the origin baseline is built from. */
export type DevEntryState = Pick<
  PlanEntry,
  | 'slug'
  | 'draftData'
  | 'publishedSlug'
  | 'publishedData'
  | 'status'
  | 'originBaseline'
>

export async function readSiteRow(tx: Tx, siteId: string): Promise<SiteRow> {
  const row = (
    await tx.select().from(site).where(eq(site.id, siteId)).limit(1)
  ).at(0)
  if (!row) throw new NotFoundError(m.server_site_not_found())
  return row
}

/** Keeps the production draft that a dev push or copy is about to replace, as a revision. */
export async function keepDraftRevision(
  tx: Tx,
  row: { id: string; draftData: EntryData },
  actorId: string,
) {
  await tx.insert(entryRevision).values({
    entryId: row.id,
    data: row.draftData,
    createdBy: actorId,
    note: 'before dev push',
    kind: 'milestone',
  })
}

export async function slugTaken(
  tx: Tx,
  collectionId: string,
  slug: string,
  exceptId?: string,
): Promise<boolean> {
  const rows = await tx
    .select({ id: entry.id })
    .from(entry)
    .where(and(eq(entry.collectionId, collectionId), eq(entry.slug, slug)))
    .limit(2)
  return rows.some((row) => row.id !== exceptId)
}

/** Duplicate-free key for a reference, so one reported in draft and ready shows once. */
export function referenceKey(item: ReferenceWarning) {
  return `${item.field}|${item.locale ?? ''}|${item.devTargetId}`
}

/**
 * Push warnings for references that were cleared. `seen` is shared between
 * the draft and the ready version of one entry, so a reference in both shows once.
 */
export function referenceWarnings(
  itemId: string | null,
  cleared: ReferenceWarning[],
  seen: Set<string>,
): PushWarning[] {
  const out: PushWarning[] = []
  for (const reference of cleared) {
    const key = referenceKey(reference)
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      itemId,
      message: `Reference cleared: "${reference.field}" pointed at an entry that is not in production.`,
      field: reference.field,
      ...(reference.locale !== undefined ? { locale: reference.locale } : {}),
      devTargetId: reference.devTargetId,
    })
  }
  return out
}

/**
 * Maps dev entry ids to production ids for reference mapping: the origin of
 * each forked entry whose production row still exists, plus the ids of entries
 * created in this write.
 */
export async function productionReferenceLookup(
  tx: Tx,
  productionSiteId: string,
  devEntries: { id: string; originEntryId: string | null }[],
  created: Map<string, string>,
): Promise<ReferenceLookup> {
  const productionIds = new Set(
    (
      await tx
        .select({ id: entry.id })
        .from(entry)
        .where(eq(entry.siteId, productionSiteId))
    ).map((row) => row.id),
  )
  const targets = referenceTargets(devEntries, productionIds, created)
  return referenceLookup(targets, productionIds)
}

export type ReadyCheckInput = {
  fields: Field[]
  requiredLanguages: string[]
  ready: EntryData
}

/**
 * Strict validation of a ready version against production, as `publishEntry`
 * does. `messages` is empty when the version may go live; `stored` is what to
 * store (single-language sites strip unknown keys).
 */
export async function readyProblems(
  tx: Tx,
  productionSite: SiteRow,
  candidate: ReadyCheckInput,
): Promise<{ messages: string[]; stored: EntryData | null }> {
  try {
    const prepared = prepareReadyData(
      {
        site: { languages: productionSite.languages },
        collection: {
          fields: candidate.fields,
          requiredLanguages: candidate.requiredLanguages,
        },
      },
      candidate.ready,
    )
    const refErrors = await validateReferences(
      productionSite.id,
      candidate.fields,
      prepared.referenceData,
      {},
      tx,
    )
    return {
      messages: refErrors.map((error) => error.message),
      stored: prepared.stored,
    }
  } catch (error) {
    if (error instanceof ValidationError) {
      return {
        messages:
          error.errors.length > 0
            ? error.errors.map((item) =>
                item.path ? `${item.path}: ${item.message}` : item.message,
              )
            : [error.message],
        stored: null,
      }
    }
    throw error
  }
}

/**
 * The origin baseline a dev entry records after it was written to production.
 * The ready part moves only when the ready version was written; otherwise it
 * keeps the old baseline, so the item stays listed as pending.
 */
export function nextOriginBaseline(
  dev: DevEntryState,
  readyWritten: boolean,
): EntryOriginBaseline {
  const old = dev.originBaseline
  return {
    slug: dev.slug,
    data: dev.draftData,
    publishedSlug: readyWritten
      ? dev.publishedSlug
      : (old?.publishedSlug ?? null),
    publishedData: readyWritten
      ? dev.publishedData
      : (old?.publishedData ?? null),
    status: readyWritten ? dev.status : (old?.status ?? 'draft'),
  }
}
