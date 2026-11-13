/**
 * The entry steps of a push: lock and verify the rows it writes, check URLs,
 * write drafts and ready versions in two passes, relink, and validate the
 * ready versions.
 */
import { and, asc, eq, inArray, sql } from 'drizzle-orm'

import {
  PLAN_CHANGED_MESSAGE,
  SCHEDULED_IN_PRODUCTION_MESSAGE,
} from '#/lib/dev-env'
import type { Tx } from '#/db'
import { collection, entry } from '#/db/schema'
import { entryTitle } from '#/lib/content/utils'
import { carryFieldValues } from '#/lib/field-content'
import { stableStringify } from '#/lib/stable-json'
import type { EntryData } from '#/lib/types'
import { ConflictError, ValidationError } from '#/server/content/errors'
import type { SiteCore } from '#/server/content/site-core'

import type { PlanEntry, PlanItem } from './plan'
import { keptFields } from './push-state'
import type { PushState, ReadyCandidate } from './push-state'
import { relinkProductionEntries } from './relink'
import { remapReferences } from './references'
import { findSlugCollisions } from './slug-collisions'
import type { SlugOwner } from './slug-collisions'
import {
  keepDraftRevisions,
  readyProblems,
  referenceWarnings,
  slugCollisionMessage,
} from './write'
import type { ProductionCollection, PushWarning } from './write'

/**
 * Locks the production rows the selected items write or change, in id order,
 * and checks each `content_version` against the plan: entry items, and the
 * entries a destructive schema item affects. A production entry that these
 * writes touch must not be scheduled now, whatever the plan showed. Returns
 * the verified versions.
 */
export async function lockAndVerifyAffected(
  tx: Tx,
  items: PlanItem[],
): Promise<Map<string, number>> {
  const expected = new Map<string, number>()
  const writesTo = new Set<string>()
  for (const item of items) {
    if (item.productionId && item.productionContentVersion !== undefined) {
      expected.set(item.productionId, item.productionContentVersion)
    }
    if (item.productionId) writesTo.add(item.productionId)
    for (const affected of item.affectedEntries ?? []) {
      expected.set(affected.id, affected.contentVersion)
      writesTo.add(affected.id)
    }
  }
  if (expected.size === 0) return new Map()
  const ids = [...expected.keys()].sort()
  const rows = await tx
    .select({
      id: entry.id,
      contentVersion: entry.contentVersion,
      scheduledAt: entry.scheduledAt,
    })
    .from(entry)
    .where(inArray(entry.id, ids))
    .orderBy(asc(entry.id))
    .for('update')
  const versions = new Map(rows.map((row) => [row.id, row.contentVersion]))
  for (const id of ids) {
    if (versions.get(id) !== expected.get(id)) {
      throw new ConflictError(PLAN_CHANGED_MESSAGE)
    }
  }
  for (const row of rows) {
    if (writesTo.has(row.id) && row.scheduledAt != null) {
      throw new ConflictError(SCHEDULED_IN_PRODUCTION_MESSAGE)
    }
  }
  return versions
}

function ownerOf(row: {
  id: string
  title?: string
  slug: string
  draftData?: EntryData
}): SlugOwner {
  return {
    id: row.id,
    title: row.title ?? row.slug,
    slug: row.slug,
    draftData: row.draftData ?? {},
  }
}

/**
 * Apply-time check of the URLs the selected entries write. The owners are read
 * inside this transaction, after the assets lock, not taken from the plan input:
 * a URL an ordinary entry save took after the plan was read is refused here.
 * The plan flags the same collisions (Apply is disabled for them), and its hash
 * covers them, so this is a backstop. Entries of the same push are checked
 * against each other too.
 */
export async function assertUrlsFree(
  tx: Tx,
  productionSiteId: string,
  items: PlanItem[],
  devById: Map<string, PlanEntry>,
) {
  const writes = items.flatMap((item) => {
    if (item.kind === 'entry.archive') return []
    const dev = item.devId ? devById.get(item.devId) : undefined
    return dev ? [{ item, dev }] : []
  })
  const ownersByKey = new Map<string, SlugOwner[]>()
  for (const write of writes) {
    const { item, dev } = write
    let owners = ownersByKey.get(dev.collectionKey)
    if (!owners) {
      owners = await readProductionUrlOwners(
        tx,
        productionSiteId,
        dev.collectionKey,
      )
      ownersByKey.set(dev.collectionKey, owners)
    }
    const production = owners.filter((row) => row.id !== item.productionId)
    const pushed = writes
      .filter(
        (other) =>
          other !== write && other.dev.collectionKey === dev.collectionKey,
      )
      .map((other) => ownerOf(other.dev))
    const holdings: ['in production' | 'in this push', SlugOwner[]][] = [
      ['in production', production],
      ['in this push', pushed],
    ]
    for (const [where, holders] of holdings) {
      const collision = findSlugCollisions(dev, holders).at(0)
      if (!collision) continue
      throw new ValidationError([
        {
          path: collision.locale ? `$i18n.${collision.locale}.$slug` : 'slug',
          message: slugCollisionMessage(collision, where),
        },
      ])
    }
  }
}

/**
 * The entries of one production collection or section, read now. A section's
 * title is its label, as in the plan.
 */
async function readProductionUrlOwners(
  tx: Tx,
  productionSiteId: string,
  collectionKey: string,
): Promise<SlugOwner[]> {
  const rows = await tx
    .select({
      id: entry.id,
      slug: entry.slug,
      draftData: entry.draftData,
      kind: collection.kind,
      label: collection.label,
      fields: collection.fields,
    })
    .from(entry)
    .innerJoin(collection, eq(entry.collectionId, collection.id))
    .where(
      and(
        eq(collection.siteId, productionSiteId),
        eq(collection.key, collectionKey),
      ),
    )
  return rows.map((row) => ({
    id: row.id,
    title:
      row.kind === 'global'
        ? row.label
        : entryTitle(row.draftData, row.fields, row.slug),
    slug: row.slug,
    draftData: row.draftData,
  }))
}

export async function readContentVersions(
  tx: Tx,
  ids: string[],
): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map()
  const rows = await tx
    .select({ id: entry.id, contentVersion: entry.contentVersion })
    .from(entry)
    .where(inArray(entry.id, ids))
  return new Map(rows.map((row) => [row.id, row.contentVersion]))
}

/**
 * Pass 1: resolves each entry item to its production entry. Entries that dev
 * created, and entries deleted in production, get a new empty production draft
 * here, so every dev id has a production id before references are mapped.
 * Returns dev id to new production id.
 */
export async function pushEntriesPassOne(
  state: PushState,
  entryItems: PlanItem[],
  devById: Map<string, PlanEntry>,
  productionCollections: ProductionCollection[],
): Promise<Map<string, string>> {
  const { tx, actor, production } = state
  const created = new Map<string, string>()
  for (const item of entryItems) {
    const dev = item.devId ? devById.get(item.devId) : undefined
    if (!dev) continue
    if (item.productionId) {
      state.targets.set(item.id, item.productionId)
      continue
    }
    if (
      dev.collectionKind === 'global' &&
      item.attention !== 'deleted-in-production'
    ) {
      // A section's single entry: it exists once its section does.
      const match = (
        await tx
          .select({ id: entry.id })
          .from(entry)
          .innerJoin(collection, eq(entry.collectionId, collection.id))
          .where(
            and(
              eq(collection.siteId, production.id),
              eq(collection.key, dev.collectionKey),
              eq(entry.slug, dev.slug),
            ),
          )
          .limit(1)
      ).at(0)
      if (match) {
        state.targets.set(item.id, match.id)
      } else {
        state.warnings.push({
          itemId: item.id,
          code: 'section-entry-missing',
          params: { slug: dev.slug },
          message: `"${dev.slug}" is not in production, so it was not pushed.`,
        })
      }
      continue
    }

    // A new entry, or one deleted in production: recreated as a draft. Its URLs
    // were checked against production in assertUrlsFree.
    const col = productionCollections.find((c) => c.key === dev.collectionKey)
    if (!col) {
      state.warnings.push({
        itemId: item.id,
        code: 'collection-missing',
        params: { collectionKey: dev.collectionKey },
        message: `Collection "${dev.collectionKey}" is not in production, so the entry was not pushed. Push the schema first.`,
      })
      continue
    }
    const row = (
      await tx
        .insert(entry)
        .values({
          siteId: production.id,
          collectionId: col.id,
          slug: dev.slug,
          status: 'draft',
          draftData: {},
          createdBy: actor.id,
          updatedBy: actor.id,
        })
        .returning({ id: entry.id })
    ).at(0)
    if (!row) throw new Error('Failed to create the production entry.')
    created.set(dev.id, row.id)
    state.targets.set(item.id, row.id)
  }
  return created
}

/**
 * Pass 2: writes each selected entry's draft, and its ready version as a
 * candidate. The production rows are locked in id order and each one's
 * `content_version` checked against the plan; the drafts they replace are
 * kept as revisions first, in one insert.
 */
export async function pushEntriesPassTwo(
  state: PushState,
  entryItems: PlanItem[],
  devById: Map<string, PlanEntry>,
  productionCollections: ProductionCollection[],
  created: Map<string, string>,
  lookup: (devId: string) => string | undefined,
): Promise<ReadyCandidate[]> {
  const { tx, actor } = state
  const candidates: ReadyCandidate[] = []
  const createdItemIds = new Set(
    [...created.keys()].map((devId) => `entry:${devId}`),
  )
  const now = new Date()

  const work = entryItems.flatMap((item) => {
    const targetId = state.targets.get(item.id)
    const dev = item.devId ? devById.get(item.devId) : undefined
    return targetId && dev
      ? [{ item, dev, targetId, isCreated: createdItemIds.has(item.id) }]
      : []
  })
  const targetIds = [...new Set(work.map((step) => step.targetId))].sort()
  const rows = new Map(
    (targetIds.length
      ? await tx
          .select()
          .from(entry)
          .where(inArray(entry.id, targetIds))
          .orderBy(asc(entry.id))
          .for('update')
      : []
    ).map((row) => [row.id, row]),
  )
  const seenTargets = new Set<string>()
  for (const { targetId, isCreated } of work) {
    const row = rows.get(targetId)
    if (!row) throw new ConflictError(PLAN_CHANGED_MESSAGE)
    // Checked in lockAndVerifyAffected. A second write to one row would find
    // the version this push already raised.
    if (
      !isCreated &&
      (seenTargets.has(targetId) ||
        row.contentVersion !== state.lockedVersions.get(row.id))
    ) {
      throw new ConflictError(PLAN_CHANGED_MESSAGE)
    }
    seenTargets.add(targetId)
  }
  await keepDraftRevisions(
    tx,
    work.flatMap(({ item, targetId, isCreated }) => {
      const row = rows.get(targetId)
      return row && (item.kind === 'entry.archive' || !isCreated) ? [row] : []
    }),
    actor.id,
  )

  for (const { item, dev, targetId } of work) {
    const row = rows.get(targetId)
    if (!row) throw new ConflictError(PLAN_CHANGED_MESSAGE)

    if (item.kind === 'entry.archive') {
      await tx
        .update(entry)
        .set({
          status: 'archived',
          contentVersion: sql`${entry.contentVersion} + 1`,
          updatedBy: actor.id,
          updatedAt: now,
        })
        .where(eq(entry.id, row.id))
      state.written.set(item.id, row.id)
      continue
    }

    const col = productionCollections.find((c) => c.id === row.collectionId)
    if (!col) throw new ConflictError(PLAN_CHANGED_MESSAGE)

    const seen = new Set<string>()
    // Fields a pending removal keeps: production's values stay in draft and ready.
    const kept = keptFields(item, state.selectedIds)
    const draft = remapReferences(dev.draftData, col.fields, lookup)
    state.warnings.push(...referenceWarnings(item.id, draft.cleared, seen))
    // A recreated entry comes back as a draft (docs/design/dev-environments.md, Needs attention).
    const readyMapped =
      dev.publishedData != null &&
      dev.publishedSlug &&
      item.attention !== 'deleted-in-production'
        ? remapReferences(dev.publishedData, col.fields, lookup)
        : null
    const readyData = readyMapped
      ? {
          data: carryFieldValues(readyMapped.data, row.publishedData, kept),
          cleared: readyMapped.cleared,
        }
      : null
    if (readyData) {
      state.warnings.push(
        ...referenceWarnings(item.id, readyData.cleared, seen),
      )
    }
    const readySlug = readyData ? dev.publishedSlug : null

    await tx
      .update(entry)
      .set({
        slug: dev.slug,
        draftData: carryFieldValues(draft.data, row.draftData, kept),
        draftVersion: sql`${entry.draftVersion} + 1`,
        contentVersion: sql`${entry.contentVersion} + 1`,
        updatedBy: actor.id,
        updatedAt: now,
        ...(readyData && readySlug
          ? {
              status: 'published' as const,
              publishedData: readyData.data,
              publishedSlug: readySlug,
              publishedAt: now,
            }
          : {}),
      })
      .where(eq(entry.id, row.id))
    state.written.set(item.id, row.id)

    if (readyData) {
      candidates.push({
        itemId: item.id,
        entryId: row.id,
        fields: col.fields,
        requiredLanguages: col.requiredLanguages,
        ready: readyData.data,
        prev: {
          publishedData: row.publishedData,
          publishedSlug: row.publishedSlug,
          publishedAt: row.publishedAt,
          status: row.status,
        },
        active: true,
      })
    }
  }
  return candidates
}

/**
 * The production entries this push wrote get their link paths recomputed from
 * the production state after all of its writes (see `relinkProductionEntries`).
 * A ready version that the next step validates follows the draft.
 */
export async function relinkWrittenEntries(
  state: PushState,
  candidates: ReadyCandidate[],
) {
  const ids = [
    ...new Set(
      [...state.written.values()].filter((id): id is string => id !== null),
    ),
  ]
  const relinked = await relinkProductionEntries(
    state.tx,
    state.production.id,
    ids,
  )
  for (const row of relinked) {
    const candidate = candidates.find(
      (item) => item.entryId === row.id && item.active,
    )
    if (candidate && row.publishedData) candidate.ready = row.publishedData
  }
}

/**
 * Strict validation of every ready candidate, with the production state as it
 * will be after the push. A candidate that fails goes back to the ready state
 * production had, and is listed as a warning. Reverting can break another
 * candidate that pointed at it, so the check repeats until nothing fails.
 */
export async function resolveReadyCandidates(
  tx: Tx,
  productionSite: SiteCore,
  candidates: ReadyCandidate[],
  warnings: PushWarning[],
) {
  let reverted = true
  while (reverted) {
    reverted = false
    for (const candidate of candidates) {
      if (!candidate.active) continue
      const { messages } = await readyProblems(tx, productionSite, candidate)
      if (messages.length === 0) continue
      await tx
        .update(entry)
        .set({
          publishedData: candidate.prev.publishedData,
          publishedSlug: candidate.prev.publishedSlug,
          publishedAt: candidate.prev.publishedAt,
          status: candidate.prev.status,
          contentVersion: sql`${entry.contentVersion} + 1`,
        })
        .where(eq(entry.id, candidate.entryId))
      candidate.active = false
      const details = messages.join('; ')
      warnings.push({
        itemId: candidate.itemId,
        code: 'ready-not-pushed',
        params: { details },
        message: `Ready version not pushed, production keeps its previous ready version: ${details}`,
      })
      reverted = true
    }
  }

  // Store what validation kept (single-language sites strip unknown keys).
  for (const candidate of candidates) {
    if (!candidate.active) continue
    const { stored } = await readyProblems(tx, productionSite, candidate)
    if (
      stored &&
      stableStringify(stored) !== stableStringify(candidate.ready)
    ) {
      await tx
        .update(entry)
        .set({ publishedData: stored })
        .where(eq(entry.id, candidate.entryId))
    }
  }
}
