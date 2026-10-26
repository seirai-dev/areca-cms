import { and, eq, inArray, sql } from 'drizzle-orm'

import { PLAN_CHANGED_MESSAGE } from '#/lib/dev-env'
import { db } from '#/db'
import {
  collection,
  entry,
  entryRevision,
  environmentPush,
  site,
} from '#/db/schema'
import type {
  EntryData,
  EntryOriginBaseline,
  EntryStatus,
  Field,
  SchemaSnapshot,
  SchemaSnapshotItem,
  SiteLanguages,
} from '#/lib/types'
import { audit } from '#/server/audit'
import { lockOrganizationForMutation } from '#/server/admin/organization-lock'
import { applySiteLanguages } from '#/server/admin/site-languages'
import { archiveDeletedContent } from '#/server/content/deletion-archive'
import {
  prepareCollectionUpsert,
  writeCollectionDelete,
  writeCollectionUpsert,
} from '#/server/content/collections'
import type { CollectionUpsertInput } from '#/server/content/collections'
import { prepareReadyData } from '#/server/content/entries'
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from '#/server/content/errors'
import { m } from '#/paraglide/messages'
import {
  prepareGlobalUpsert,
  writeGlobalDelete,
  writeGlobalUpsert,
} from '#/server/content/globals'
import type { GlobalInput } from '#/server/content/globals'
import { validateReferences } from '#/server/content/validation'
import { AppError } from '#/server/http/app-error'
import { requestPublication } from '#/server/publishing/publications'

import { lockProductionSite } from './lock'
import { buildPlan, selectPlanItems, stableStringify } from './plan'
import type { PlanEntry, PlanInput, PlanItem } from './plan'
import { loadPlanContext } from './load-plan'
import {
  referenceLookup,
  referenceTargets,
  remapReferences,
} from './references'
import type { ReferenceWarning } from './references'
import {
  lockDevEnvironment,
  lockProductionRow,
  readDevEnvironment,
} from './rows'
import type { DevEnvActor, SiteRow, Tx } from './rows'

/** The message a push refused on a stale plan shows. */
export { PLAN_CHANGED_MESSAGE }

export type PushInput = {
  devSiteId: string
  /** The `planHash` the push screen showed. */
  planHash: string
  /** Item ids the agency unticked. */
  exclude: string[]
  /** Needs-attention item ids set to Apply. */
  apply: string[]
  goLive: boolean
}

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

export type GoLiveOutcome = Awaited<ReturnType<typeof requestPublication>>

export type PushResult = {
  counts: PushCounts
  warnings: PushWarning[]
  /** Every item that was written, with the production entry it wrote to (null for schema and languages). */
  written: { itemId: string; productionId: string | null }[]
  /** Set when `goLive` was requested: the production build request, or why it was refused. */
  publication: GoLiveOutcome | null
}

type CommittedPush = Omit<PushResult, 'publication'> & {
  productionSiteId: string
}

type ProductionCollection = typeof collection.$inferSelect

/** A ready version written in pass 2 that still has to pass strict validation. */
type ReadyCandidate = {
  itemId: string
  entryId: string
  fields: Field[]
  requiredLanguages: string[]
  ready: EntryData
  prev: {
    publishedData: EntryData | null
    publishedSlug: string | null
    publishedAt: Date | null
    status: EntryStatus
  }
  active: boolean
}

/**
 * Pushes the selected changes of a dev env into its production site
 * (docs/design/dev-environments.md, "Push"). Agency admins only, with a fresh
 * session (checked by the server function). One transaction for the writes;
 * go live, when asked, runs after it commits.
 */
export async function pushDevEnvironment(
  actor: DevEnvActor,
  input: PushInput,
): Promise<PushResult> {
  const probe = await readDevEnvironment(input.devSiteId)
  const committed = await db.transaction((tx) =>
    runPush(tx, actor, input, probe.organizationId),
  )
  const publication = input.goLive
    ? await goLiveAfterPush(committed.productionSiteId, actor.id)
    : null
  const { productionSiteId: _productionSiteId, ...result } = committed
  return { ...result, publication }
}

async function goLiveAfterPush(
  productionSiteId: string,
  actorId: string,
): Promise<GoLiveOutcome> {
  try {
    return await requestPublication({ siteId: productionSiteId, actorId })
  } catch (error) {
    if (error instanceof AppError) return { ok: false, errors: [error.message] }
    throw error
  }
}

async function runPush(
  tx: Tx,
  actor: DevEnvActor,
  input: PushInput,
  organizationId: string,
): Promise<CommittedPush> {
  await lockOrganizationForMutation(tx, organizationId)
  const dev = await lockDevEnvironment(tx, input.devSiteId)
  const prod = await lockProductionRow(tx, dev.parentSiteId)
  await lockProductionSite(tx, prod.id)

  const context = await loadPlanContext(tx, dev.id)
  const plan = buildPlan(context.planInput)
  if (plan.planHash !== input.planHash) {
    throw new ConflictError(PLAN_CHANGED_MESSAGE)
  }
  const { selected } = selectPlanItems(plan.items, {
    exclude: input.exclude,
    apply: input.apply,
  })

  const state: PushState = {
    tx,
    actor,
    organizationId,
    production: prod,
    planInput: context.planInput,
    warnings: [],
    targets: new Map(),
    written: new Map(),
  }

  // Schema first, then languages, so entries see the collections and languages they need.
  const schemaItems = selected.filter((item) => item.kind.startsWith('schema.'))
  await pushSchema(state, schemaItems)
  const languagesItem = selected.find((item) => item.kind === 'languages')
  if (languagesItem) {
    await pushLanguages(state)
    state.written.set(languagesItem.id, null)
  }
  for (const item of schemaItems) state.written.set(item.id, null)

  // Re-read after the schema and languages writes.
  const productionCollections = await tx
    .select()
    .from(collection)
    .where(eq(collection.siteId, prod.id))
  const productionSite = await readRow(tx, prod.id)

  const entryItems = selected
    .filter((item) => item.kind.startsWith('entry.'))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const devById = new Map(
    context.planInput.devEntries.map((row) => [row.id, row]),
  )

  const created = await pushEntriesPassOne(
    state,
    entryItems,
    devById,
    productionCollections,
  )
  const lookup = await buildReferenceLookup(
    tx,
    prod.id,
    context.planInput.devEntries,
    created,
  )
  const candidates = await pushEntriesPassTwo(
    state,
    entryItems,
    devById,
    productionCollections,
    created,
    lookup,
  )
  await resolveReadyCandidates(tx, productionSite, candidates, state.warnings)

  await writeBaselines(state, entryItems, devById, candidates)
  await writeSchemaBaseline(state, selected, context.planInput, dev.id)

  const writtenItems = plan.items.filter((item) => state.written.has(item.id))
  const counts: PushCounts = {
    schema: writtenItems.filter(
      (item) => item.kind.startsWith('schema.') || item.kind === 'languages',
    ).length,
    new: writtenItems.filter((item) => created.has(item.devId ?? '')).length,
    changed: writtenItems.filter(
      (item) => item.kind === 'entry.change' && !created.has(item.devId ?? ''),
    ).length,
    archived: writtenItems.filter((item) => item.kind === 'entry.archive')
      .length,
    skipped: plan.items.length - writtenItems.length,
    warnings: state.warnings.length,
  }
  const items = plan.items.map((item) => ({
    id: item.id,
    kind: item.kind,
    decision: state.written.has(item.id) ? 'applied' : 'skipped',
    productionId: state.written.get(item.id) ?? item.productionId ?? null,
  }))

  await tx.insert(environmentPush).values({
    devSiteId: dev.id,
    productionSiteId: prod.id,
    kind: 'push',
    actorId: actor.id,
    counts,
    items,
  })
  await audit(
    {
      organizationId,
      siteId: prod.id,
      actorId: actor.id,
      action: 'dev_env.push',
      targetType: 'site',
      targetId: dev.id,
      meta: { slug: dev.slug, ...counts },
    },
    tx,
  )

  return {
    counts,
    warnings: state.warnings,
    written: [...state.written].map(([itemId, productionId]) => ({
      itemId,
      productionId,
    })),
    productionSiteId: prod.id,
  }
}

type PushState = {
  tx: Tx
  actor: DevEnvActor
  organizationId: string
  production: SiteRow
  planInput: PlanInput
  warnings: PushWarning[]
  /** Plan item id to the production entry it writes to, resolved in pass 1. */
  targets: Map<string, string>
  /** Plan item id to the production id it wrote to (null for schema and languages). */
  written: Map<string, string | null>
}

async function readRow(tx: Tx, siteId: string): Promise<SiteRow> {
  const row = (
    await tx.select().from(site).where(eq(site.id, siteId)).limit(1)
  ).at(0)
  if (!row) throw new NotFoundError(m.server_site_not_found())
  return row
}

async function pushSchema(state: PushState, items: PlanItem[]) {
  const { tx, actor, production } = state
  // Adds and changes first, so a removal never leaves a reference dangling mid-push.
  const ordered = [
    ...items.filter((item) => item.kind !== 'schema.remove'),
    ...items.filter((item) => item.kind === 'schema.remove'),
  ]
  for (const item of ordered) {
    const key = item.collectionKey ?? ''
    const existing = (
      await tx
        .select({
          id: collection.id,
          key: collection.key,
          kind: collection.kind,
        })
        .from(collection)
        .where(
          and(eq(collection.siteId, production.id), eq(collection.key, key)),
        )
        .limit(1)
    ).at(0)

    if (item.kind === 'schema.remove') {
      if (!existing) continue
      const removal = {
        id: existing.id,
        key,
        organizationId: state.organizationId,
      }
      if (existing.kind === 'global') {
        await writeGlobalDelete(tx, production.id, removal, actor.id)
      } else {
        await writeCollectionDelete(tx, production.id, removal, actor.id)
      }
      continue
    }

    const devDef = state.planInput.dev.collections.find(
      (def) => def.key === key,
    )
    if (!devDef) {
      throw new ValidationError([
        { path: key, message: `Collection "${key}" is not in the dev env.` },
      ])
    }
    const confirmDropFields = (item.summary.droppedFields ?? []).map(
      (drop) => drop.key,
    )
    // A dropped field's content is archived with the collection before it is purged.
    if (confirmDropFields.length > 0 && existing) {
      await archiveDeletedContent(
        tx,
        state.organizationId,
        'collection',
        existing.id,
      )
    }
    if (devDef.kind === 'global') {
      const input: GlobalInput = {
        key,
        label: devDef.label,
        fields: devDef.fields,
        seo: devDef.seoEnabled,
        previewPath: devDef.previewPath,
        enabled: devDef.enabled,
        requiredLanguages: devDef.requiredLanguages,
        confirmDropFields,
      }
      await writeGlobalUpsert(
        tx,
        production.id,
        input,
        prepareGlobalUpsert(input),
      )
    } else {
      const input = collectionInput(devDef, confirmDropFields)
      await writeCollectionUpsert(
        tx,
        production.id,
        input,
        prepareCollectionUpsert(input),
      )
    }
  }
}

function collectionInput(
  def: SchemaSnapshotItem,
  confirmDropFields: string[],
): CollectionUpsertInput {
  return {
    key: def.key,
    label: def.label,
    routePattern: def.routePattern,
    fields: def.fields,
    enabled: def.enabled,
    requiredLanguages: def.requiredLanguages,
    localizedRoutes: def.localizedRoutes,
    confirmDropFields,
  }
}

async function pushLanguages(state: PushState) {
  const languages: SiteLanguages | null = state.planInput.dev.languages
  if (!languages) return
  await applySiteLanguages(
    state.tx,
    state.production.id,
    { main: languages.main, all: languages.all },
    state.actor.id,
  )
}

/** Duplicate-free key for a warning, so a reference reported in draft and ready shows once. */
function warningKey(item: ReferenceWarning) {
  return `${item.field}|${item.locale ?? ''}|${item.devTargetId}`
}

function referenceWarnings(
  itemId: string,
  cleared: ReferenceWarning[],
  seen: Set<string>,
): PushWarning[] {
  const out: PushWarning[] = []
  for (const reference of cleared) {
    const key = warningKey(reference)
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

async function slugTaken(
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

/**
 * Pass 1: resolves each entry item to its production entry. Entries that dev
 * created, and entries deleted in production, get a new empty production draft
 * here, so every dev id has a production id before references are mapped.
 * Returns dev id to new production id.
 */
async function pushEntriesPassOne(
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
    if (item.kind === 'entry.change' && item.attention === null) {
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
          message: `"${dev.slug}" is not in production, so it was not pushed.`,
        })
      }
      continue
    }

    // A new entry, or one deleted in production: recreated as a draft.
    const col = productionCollections.find((c) => c.key === dev.collectionKey)
    if (!col) {
      state.warnings.push({
        itemId: item.id,
        message: `Collection "${dev.collectionKey}" is not in production, so the entry was not pushed. Push the schema first.`,
      })
      continue
    }
    if (await slugTaken(tx, col.id, dev.slug)) {
      state.warnings.push({
        itemId: item.id,
        message: `Production already has an entry with the slug "${dev.slug}" in ${dev.collectionKey}, so the entry was not pushed.`,
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
 * Maps dev entry ids to production ids for reference mapping: the origin of
 * each forked entry that still exists in production, and the ids of the
 * entries created in pass 1.
 */
async function buildReferenceLookup(
  tx: Tx,
  productionSiteId: string,
  devEntries: PlanEntry[],
  created: Map<string, string>,
) {
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

/**
 * Pass 2: writes each selected entry's draft, and its ready version as a
 * candidate. The production row is locked and its `content_version` checked
 * against the plan; the draft it replaces is kept as a revision first.
 */
async function pushEntriesPassTwo(
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

  for (const item of entryItems) {
    const targetId = state.targets.get(item.id)
    if (!targetId) continue
    const dev = item.devId ? devById.get(item.devId) : undefined
    if (!dev) continue
    const isCreated = createdItemIds.has(item.id)

    const row = (
      await tx
        .select()
        .from(entry)
        .where(eq(entry.id, targetId))
        .for('update')
        .limit(1)
    ).at(0)
    if (!row) throw new ConflictError(PLAN_CHANGED_MESSAGE)
    if (
      !isCreated &&
      item.productionContentVersion !== undefined &&
      row.contentVersion !== item.productionContentVersion
    ) {
      throw new ConflictError(PLAN_CHANGED_MESSAGE)
    }

    if (item.kind === 'entry.archive') {
      await tx.insert(entryRevision).values({
        entryId: row.id,
        data: row.draftData,
        createdBy: actor.id,
        note: 'before dev push',
        kind: 'milestone',
      })
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
    if (
      !isCreated &&
      dev.slug !== row.slug &&
      (await slugTaken(tx, row.collectionId, dev.slug, row.id))
    ) {
      state.warnings.push({
        itemId: item.id,
        message: `Production already has an entry with the slug "${dev.slug}", so the entry was not pushed.`,
      })
      continue
    }
    if (!isCreated) {
      await tx.insert(entryRevision).values({
        entryId: row.id,
        data: row.draftData,
        createdBy: actor.id,
        note: 'before dev push',
        kind: 'milestone',
      })
    }

    const seen = new Set<string>()
    const draft = remapReferences(dev.draftData, col.fields, lookup)
    state.warnings.push(...referenceWarnings(item.id, draft.cleared, seen))
    // A recreated entry comes back as a draft (docs/design/dev-environments.md, Needs attention).
    const readyData =
      dev.publishedData != null &&
      dev.publishedSlug &&
      item.attention !== 'deleted-in-production'
        ? remapReferences(dev.publishedData, col.fields, lookup)
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
        draftData: draft.data,
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

async function readyProblems(
  tx: Tx,
  productionSite: SiteRow,
  candidate: ReadyCandidate,
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
 * Strict validation of every ready candidate, with the production state as it
 * will be after the push. A candidate that fails goes back to the ready state
 * production had, and is listed as a warning. Reverting can break another
 * candidate that pointed at it, so the check repeats until nothing fails.
 */
async function resolveReadyCandidates(
  tx: Tx,
  productionSite: SiteRow,
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
      warnings.push({
        itemId: candidate.itemId,
        message: `Ready version not pushed, production keeps its previous ready version: ${messages.join('; ')}`,
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

/**
 * Baselines (step 8), per item: each pushed dev entry records the dev-side
 * content it now matches, and the production `content_version` it was written
 * at. The ready part keeps its old baseline when production refused the ready
 * version, so the item stays listed.
 */
async function writeBaselines(
  state: PushState,
  entryItems: PlanItem[],
  devById: Map<string, PlanEntry>,
  candidates: ReadyCandidate[],
) {
  const { tx } = state
  const writtenIds = entryItems
    .map((item) => state.written.get(item.id))
    .filter((id): id is string => typeof id === 'string')
  if (writtenIds.length === 0) return
  const versions = new Map(
    (
      await tx
        .select({ id: entry.id, contentVersion: entry.contentVersion })
        .from(entry)
        .where(inArray(entry.id, writtenIds))
    ).map((row) => [row.id, row.contentVersion]),
  )

  for (const item of entryItems) {
    const productionId = state.written.get(item.id)
    if (!productionId || !item.devId) continue
    const dev = devById.get(item.devId)
    if (!dev) continue
    const candidate = candidates.find((c) => c.itemId === item.id)
    const readyPushed = candidate ? candidate.active : true
    const old: EntryOriginBaseline | null = dev.originBaseline
    const baseline: EntryOriginBaseline = {
      slug: dev.slug,
      data: dev.draftData,
      publishedSlug: readyPushed
        ? dev.publishedSlug
        : (old?.publishedSlug ?? null),
      publishedData: readyPushed
        ? dev.publishedData
        : (old?.publishedData ?? null),
      status: readyPushed ? dev.status : (old?.status ?? 'draft'),
    }
    await tx
      .update(entry)
      .set({
        originEntryId: productionId,
        originBaseline: baseline,
        originContentVersion: versions.get(productionId) ?? null,
      })
      .where(eq(entry.id, dev.id))
  }
}

/**
 * Schema baseline, per item: applied schema items take the dev definition (or
 * leave the baseline when removed), skipped ones keep the old one, so they
 * stay listed. Languages move only when they were applied.
 */
async function writeSchemaBaseline(
  state: PushState,
  selected: PlanItem[],
  planInput: PlanInput,
  devSiteId: string,
) {
  const { tx } = state
  const base: SchemaSnapshot = planInput.base ?? {
    languages: null,
    collections: [],
  }
  const byKey = new Map(base.collections.map((def) => [def.key, def]))
  for (const item of selected) {
    if (!item.kind.startsWith('schema.') || !item.collectionKey) continue
    if (item.kind === 'schema.remove') {
      byKey.delete(item.collectionKey)
      continue
    }
    const devDef = planInput.dev.collections.find(
      (def) => def.key === item.collectionKey,
    )
    if (devDef) byKey.set(item.collectionKey, devDef)
  }
  const languagesApplied = selected.some((item) => item.kind === 'languages')
  const next: SchemaSnapshot = {
    languages: languagesApplied ? planInput.dev.languages : base.languages,
    collections: [...byKey.values()].sort((a, b) =>
      a.key < b.key ? -1 : a.key > b.key ? 1 : 0,
    ),
  }
  const now = new Date()
  await tx
    .update(site)
    .set({ schemaBaseline: next, lastPushedAt: now, updatedAt: now })
    .where(eq(site.id, devSiteId))
}
