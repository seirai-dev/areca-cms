import { and, eq, sql } from 'drizzle-orm'

import { COPY_CONFLICT_MESSAGE, COPY_UNLINKED_MESSAGE } from '#/lib/dev-env'
import { db } from '#/db'
import { collection, entry, environmentPush, site } from '#/db/schema'
import type { EntryData } from '#/lib/types'
import { audit } from '#/server/audit'
import { lockOrganizationForMutation } from '#/server/admin/organization-lock'
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from '#/server/content/errors'
import { m } from '#/paraglide/messages'

import { lockProductionSite } from './lock'
import { deepEqual } from './plan'
import { remapReferences } from './references'
import type { ReferenceWarning } from './references'
import {
  lockDevEnvironment,
  lockProductionRow,
  readDevEnvironment,
} from './rows'
import type { DevEnvActor, Tx } from './rows'
import { schemaSnapshot } from './schema-snapshot'
import {
  keepDraftRevision,
  nextOriginBaseline,
  productionReferenceLookup,
  readyProblems,
  referenceKey,
  referenceWarnings,
  slugTaken,
} from './write'
import type { PushCounts } from './write'

export type CopyInput = {
  /** The dev entry or section to copy. */
  devEntryId: string
  /** Also make the production ready version the dev ready version (strict validation). */
  markReady?: boolean
  /** Replace a production draft that changed since the last sync, or an unlinked one with the same slug. */
  overwrite?: boolean
}

export type ClearedReference = Pick<ReferenceWarning, 'field' | 'devTargetId'> &
  Partial<Pick<ReferenceWarning, 'locale'>>

export type CopyResult = {
  productionId: string
  /** True when the copy created a new production entry. */
  created: boolean
  /** Human-readable notes: a ready version that was not copied, cleared references. */
  warnings: string[]
  clearedReferences: ClearedReference[]
}

/**
 * Copies one dev entry or section into production as its draft
 * (docs/design/dev-environments.md, "Copy to production (one item)"). The live
 * version is untouched unless `markReady` copies the dev ready version too.
 * Agency admins only, with a fresh session (checked by the server function).
 */
export async function copyEntryToProduction(
  actor: DevEnvActor,
  input: CopyInput,
): Promise<CopyResult> {
  const source = (
    await db
      .select({ siteId: entry.siteId })
      .from(entry)
      .where(eq(entry.id, input.devEntryId))
      .limit(1)
  ).at(0)
  if (!source) throw new NotFoundError(m.server_entry_not_found())
  // Anything that is not a dev env is NotFound, as for every dev action.
  const dev = await readDevEnvironment(source.siteId)
  return db.transaction((tx) =>
    runCopy(tx, actor, input, dev.id, dev.organizationId),
  )
}

async function runCopy(
  tx: Tx,
  actor: DevEnvActor,
  input: CopyInput,
  devSiteId: string,
  organizationId: string,
): Promise<CopyResult> {
  const markReady = input.markReady ?? false
  const overwrite = input.overwrite ?? false

  await lockOrganizationForMutation(tx, organizationId)
  const dev = await lockDevEnvironment(tx, devSiteId)
  const prod = await lockProductionRow(tx, dev.parentSiteId)
  await lockProductionSite(tx, prod.id)

  const source = (
    await tx
      .select()
      .from(entry)
      .where(and(eq(entry.id, input.devEntryId), eq(entry.siteId, dev.id)))
      .for('update')
      .limit(1)
  ).at(0)
  if (!source) throw new NotFoundError(m.server_entry_not_found())
  if (source.status === 'archived') {
    throw new ValidationError([
      {
        path: '',
        message:
          'Archived in development. Push it from the push screen instead.',
      },
    ])
  }

  const devCollection = (
    await tx
      .select()
      .from(collection)
      .where(eq(collection.id, source.collectionId))
      .limit(1)
  ).at(0)
  if (!devCollection) throw new NotFoundError(m.server_collection_not_found())

  // The collection must match production exactly, by key and kind and every
  // definition detail (docs/design/dev-environments.md, "Copy to production").
  const devSchema = await schemaSnapshot(tx, dev.id)
  const productionSchema = await schemaSnapshot(tx, prod.id)
  const devDef = devSchema.collections.find(
    (def) => def.key === devCollection.key,
  )
  const productionDef = productionSchema.collections.find(
    (def) => def.key === devCollection.key,
  )
  if (!devDef || !productionDef || !deepEqual(devDef, productionDef)) {
    throw new ConflictError('Push the schema first.')
  }

  const prodCollection = (
    await tx
      .select()
      .from(collection)
      .where(
        and(
          eq(collection.siteId, prod.id),
          eq(collection.key, devCollection.key),
        ),
      )
      .limit(1)
  ).at(0)
  if (!prodCollection) throw new ConflictError('Push the schema first.')

  const devEntries = await tx
    .select({ id: entry.id, originEntryId: entry.originEntryId })
    .from(entry)
    .where(eq(entry.siteId, dev.id))

  // Target: the production entry the dev entry was forked from, else the
  // production entry in the same collection with the same slug.
  let target = source.originEntryId
    ? (
        await tx
          .select()
          .from(entry)
          .where(
            and(eq(entry.id, source.originEntryId), eq(entry.siteId, prod.id)),
          )
          .for('update')
          .limit(1)
      ).at(0)
    : undefined
  const linked = target !== undefined
  if (!target) {
    target = (
      await tx
        .select()
        .from(entry)
        .where(
          and(
            eq(entry.siteId, prod.id),
            eq(entry.collectionId, prodCollection.id),
            eq(entry.slug, source.slug),
          ),
        )
        .for('update')
        .limit(1)
    ).at(0)
    if (
      target &&
      devEntries.some(
        (other) => other.id !== source.id && other.originEntryId === target?.id,
      )
    ) {
      throw new ConflictError(
        `"${source.slug}" in production is already linked to another development entry.`,
      )
    }
  }

  if (target) {
    if (target.scheduledAt != null) {
      throw new ConflictError(
        'Scheduled in production. Resolve the schedule first.',
      )
    }
    const changed =
      !linked || source.originContentVersion !== target.contentVersion
    if (changed && !overwrite) {
      throw new ConflictError(
        linked ? COPY_CONFLICT_MESSAGE : COPY_UNLINKED_MESSAGE,
      )
    }
    if (
      linked &&
      source.slug !== target.slug &&
      (await slugTaken(tx, prodCollection.id, source.slug, target.id))
    ) {
      throw new ConflictError(
        `Production already has an entry with the slug "${source.slug}", so the entry was not copied.`,
      )
    }
  }

  const created = !target
  let productionId: string
  if (target) {
    productionId = target.id
    await keepDraftRevision(tx, target, actor.id)
  } else {
    const inserted = (
      await tx
        .insert(entry)
        .values({
          siteId: prod.id,
          collectionId: prodCollection.id,
          slug: source.slug,
          status: 'draft',
          draftData: {},
          createdBy: actor.id,
          updatedBy: actor.id,
        })
        .returning({ id: entry.id })
    ).at(0)
    if (!inserted) throw new Error('Failed to create the production entry.')
    productionId = inserted.id
  }

  const lookup = await productionReferenceLookup(
    tx,
    prod.id,
    devEntries,
    created ? new Map([[source.id, productionId]]) : new Map(),
  )
  const fields = prodCollection.fields
  const draft = remapReferences(source.draftData, fields, lookup)
  const clearedAll: ReferenceWarning[] = [...draft.cleared]
  const warnings: string[] = []

  let readyStored: EntryData | null = null
  let readySlug: string | null = null
  if (markReady) {
    if (source.publishedData != null && source.publishedSlug) {
      const ready = remapReferences(source.publishedData, fields, lookup)
      clearedAll.push(...ready.cleared)
      const checked = await readyProblems(tx, prod, {
        fields,
        requiredLanguages: prodCollection.requiredLanguages,
        ready: ready.data,
      })
      if (checked.messages.length > 0) {
        warnings.push(
          `Ready version not copied, production keeps its previous ready version: ${checked.messages.join('; ')}`,
        )
      } else {
        readyStored = checked.stored
        readySlug = source.publishedSlug
      }
    } else {
      warnings.push('Not ready in development, so it was copied as a draft.')
    }
  }

  const seen = new Set<string>()
  const clearedReferences = clearedAll.filter((reference) => {
    const key = referenceKey(reference)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  warnings.push(
    ...referenceWarnings(null, clearedReferences, new Set()).map(
      (warning) => warning.message,
    ),
  )

  const now = new Date()
  const updated = (
    await tx
      .update(entry)
      .set({
        slug: source.slug,
        draftData: draft.data,
        draftVersion: sql`${entry.draftVersion} + 1`,
        contentVersion: sql`${entry.contentVersion} + 1`,
        updatedBy: actor.id,
        updatedAt: now,
        ...(readyStored && readySlug
          ? {
              status: 'published' as const,
              publishedData: readyStored,
              publishedSlug: readySlug,
              publishedAt: now,
            }
          : {}),
      })
      .where(eq(entry.id, productionId))
      .returning({ contentVersion: entry.contentVersion })
  ).at(0)
  if (!updated) throw new Error('Failed to write the production entry.')

  // The dev entry now matches what production holds: it is linked, and its
  // baseline and production version are recorded (Decision 11).
  await tx
    .update(entry)
    .set({
      originEntryId: productionId,
      originBaseline: nextOriginBaseline(source, readyStored !== null),
      originContentVersion: updated.contentVersion,
    })
    .where(eq(entry.id, source.id))
  await tx
    .update(site)
    .set({ lastPushedAt: now, updatedAt: now })
    .where(eq(site.id, dev.id))

  const counts: PushCounts = {
    schema: 0,
    new: created ? 1 : 0,
    changed: created ? 0 : 1,
    archived: 0,
    skipped: 0,
    warnings: warnings.length,
  }
  await tx.insert(environmentPush).values({
    devSiteId: dev.id,
    productionSiteId: prod.id,
    kind: 'copy',
    actorId: actor.id,
    counts,
    items: [
      {
        id: `entry:${source.id}`,
        kind: created ? 'entry.new' : 'entry.change',
        decision: 'applied',
        productionId,
      },
    ],
  })
  await audit(
    {
      organizationId,
      siteId: prod.id,
      actorId: actor.id,
      action: 'dev_env.copy_entry',
      targetType: 'entry',
      targetId: productionId,
      meta: {
        slug: source.slug,
        collectionKey: devCollection.key,
        created,
        markReady,
        overwrite,
        warnings: warnings.length,
      },
    },
    tx,
  )

  return { productionId, created, warnings, clearedReferences }
}
