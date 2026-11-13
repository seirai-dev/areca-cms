/**
 * Writes shared by a push and a copy to production (docs/design/dev-environments.md,
 * "Push" and "Copy to production"): the draft snapshot kept before a
 * production draft is replaced, slug checks, strict ready validation, reference
 * lookups and the origin baseline a dev entry records. Everything runs inside
 * the caller's transaction, under the production locks.
 */
import { and, eq } from 'drizzle-orm'

import type { collection } from '#/db/schema'
import { entry, entryRevision } from '#/db/schema'
import type { DevEnvWarning } from '#/lib/dev-env'
import { carryFieldValues } from '#/lib/field-content'
import type { EntryData, EntryOriginBaseline, Field } from '#/lib/types'
import { prepareReadyData } from '#/server/content/entries'
import { ValidationError } from '#/server/content/errors'
import { languageName } from '#/server/content/locale-validation'
import { validateReferences } from '#/server/content/validation'

import type { PlanEntry } from './plan'
import type { SlugCollision } from './slug-collisions'
import { referenceLookup, referenceTargets } from './references'
import type { ReferenceLookup, ReferenceWarning } from './references'
import type { SiteCore } from '#/server/content/site-core'
import type { Tx } from '#/db'

export type ProductionCollection = typeof collection.$inferSelect

/** A warning of a push, about one plan item when it has one. */
export type PushWarning = DevEnvWarning & {
  /** The plan item the warning is about, when there is one. */
  itemId: string | null
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

/** The revision note of a production draft a dev push or copy replaces. */
export const BEFORE_DEV_PUSH_NOTE = 'before dev push'

/** Keeps the production drafts that a dev push is about to replace, as revisions, in one insert. */
export async function keepDraftRevisions(
  tx: Tx,
  rows: { id: string; draftData: EntryData }[],
  actorId: string,
) {
  // Chunks stay under the driver's bind-parameter limit.
  for (let start = 0; start < rows.length; start += 1000) {
    await tx.insert(entryRevision).values(
      rows.slice(start, start + 1000).map((row) => ({
        entryId: row.id,
        data: row.draftData,
        createdBy: actorId,
        note: BEFORE_DEV_PUSH_NOTE,
        kind: 'milestone' as const,
      })),
    )
  }
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
  return `${item.kind ?? 'reference'}|${item.field}|${item.locale ?? ''}|${item.devTargetId}`
}

/**
 * Warnings for references that were cleared. `seen` is shared between the
 * draft and the ready version of one entry, so a reference in both shows once.
 */
export function referenceWarningList(
  cleared: ReferenceWarning[],
  seen: Set<string>,
): DevEnvWarning[] {
  const out: DevEnvWarning[] = []
  for (const reference of cleared) {
    const key = referenceKey(reference)
    if (seen.has(key)) continue
    seen.add(key)
    const params = {
      field: reference.field,
      ...(reference.locale !== undefined ? { locale: reference.locale } : {}),
      devTargetId: reference.devTargetId,
    }
    if (reference.kind === 'link') {
      out.push({
        code: 'link-cleared',
        params,
        message: `Link cleared: "${reference.field}" linked to an entry that is not in production. The text stays, without the link.`,
      })
      continue
    }
    out.push({
      code: 'reference-cleared',
      params,
      message: `Reference cleared: "${reference.field}" pointed at an entry that is not in production.`,
    })
  }
  return out
}

/** Push warnings for references that were cleared, about one plan item. */
export function referenceWarnings(
  itemId: string | null,
  cleared: ReferenceWarning[],
  seen: Set<string>,
): PushWarning[] {
  return referenceWarningList(cleared, seen).map((warning) => ({
    ...warning,
    itemId,
  }))
}

/**
 * The English error for a URL another entry holds. `where` says which entry
 * holds it: production, or an entry of the same push.
 */
export function slugCollisionMessage(
  collision: SlugCollision,
  where: 'in production' | 'in this push',
): string {
  const url =
    collision.locale !== undefined
      ? `The ${languageName(collision.locale)} URL '${collision.slug}'`
      : `The URL '${collision.slug}'`
  return `${url} is already used by '${collision.collidesWith}' ${where}.`
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
  productionSite: SiteCore,
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
 * keeps the old baseline, so the item stays listed as pending. `keptFields`
 * are fields a pending removal keeps in production: their baseline is not
 * advanced, so the entry stays listed until the removal is applied.
 */
export function nextOriginBaseline(
  dev: DevEntryState,
  readyWritten: boolean,
  keptFields: string[] = [],
): EntryOriginBaseline {
  const old = dev.originBaseline
  const data = carryFieldValues(dev.draftData, old?.data ?? null, keptFields)
  let publishedData: EntryData | null = old?.publishedData ?? null
  if (readyWritten) {
    publishedData =
      dev.publishedData == null
        ? null
        : carryFieldValues(
            dev.publishedData,
            old?.publishedData ?? null,
            keptFields,
          )
  }
  return {
    slug: dev.slug,
    data,
    publishedSlug: readyWritten
      ? dev.publishedSlug
      : (old?.publishedSlug ?? null),
    publishedData,
    status: readyWritten ? dev.status : (old?.status ?? 'draft'),
  }
}
