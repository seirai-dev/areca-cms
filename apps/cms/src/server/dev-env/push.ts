import { and, asc, eq, inArray, sql } from 'drizzle-orm'

import {
  PLAN_CHANGED_MESSAGE,
  SCHEDULED_IN_PRODUCTION_MESSAGE,
} from '#/lib/dev-env'
import { db } from '#/db'
import { collection, entry, environmentPush, site } from '#/db/schema'
import { carryFieldValues, withoutFieldKeys } from '#/lib/field-content'
import type {
  ContentKind,
  EntryData,
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
  writeCollectionUpsert,
} from '#/server/content/collections'
import type { CollectionUpsertInput } from '#/server/content/collections'
import {
  assertKindsUnchanged,
  validateContentDefinitions,
} from '#/server/content/content-definitions'
import type { ContentDefinition } from '#/server/content/content-definitions'
import { ConflictError, ValidationError } from '#/server/content/errors'
import {
  prepareGlobalUpsert,
  writeGlobalUpsert,
} from '#/server/content/globals'
import type { GlobalInput } from '#/server/content/globals'
import { AppError } from '#/server/http/app-error'
import { requestPublication } from '#/server/publishing/publications'

import { lockProductionSite } from './lock'
import {
  buildPlan,
  removedFieldKeysOf,
  selectPlanItems,
  stableStringify,
} from './plan'
import type { PlanEntry, PlanInput, PlanItem } from './plan'
import { findSlugCollisions } from './slug-collisions'
import type { SlugOwner } from './slug-collisions'
import { loadPlanContext } from './load-plan'
import { remapReferences } from './references'
import {
  lockDevEnvironment,
  lockProductionRow,
  readDevEnvironment,
} from './rows'
import type { DevEnvActor, SiteRow, Tx } from './rows'
import {
  keepDraftRevision,
  nextOriginBaseline,
  productionReferenceLookup,
  readSiteRow,
  readyProblems,
  referenceWarnings,
  slugCollisionMessage,
} from './write'
import type { ProductionCollection, PushCounts, PushWarning } from './write'

export type { PushCounts, PushWarning } from './write'

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

export type GoLiveOutcome = Awaited<ReturnType<typeof requestPublication>>

export type PushResult = {
  counts: PushCounts
  warnings: PushWarning[]
  /**
   * Every item that was written, with the production entry it wrote to (null
   * for schema and languages) and that entry's collection kind (null when it
   * has none). The push screen links a section to its globals page.
   */
  written: {
    itemId: string
    productionId: string | null
    collectionKind: ContentKind | null
  }[]
  /** Set when `goLive` was requested: the production build request, or why it was refused. */
  publication: GoLiveOutcome | null
}

type CommittedPush = Omit<PushResult, 'publication'> & {
  productionSiteId: string
}

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
  /** Plan entry item id to the collection kind of its dev entry. */
  const kinds = new Map<string, ContentKind>(
    context.planInput.devEntries.map((devEntry) => [
      `entry:${devEntry.id}`,
      devEntry.collectionKind,
    ]),
  )
  if (plan.planHash !== input.planHash) {
    throw new ConflictError(PLAN_CHANGED_MESSAGE)
  }
  const { selected } = selectPlanItems(plan.items, {
    exclude: input.exclude,
    apply: input.apply,
  })
  const schemaItems = selected.filter((item) => item.kind.startsWith('schema.'))
  const languagesItem = selected.find((item) => item.kind === 'languages')
  const entryItems = selected
    .filter((item) => item.kind.startsWith('entry.'))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

  // The whole resulting schema is checked once, before any write.
  checkResultingSchema(context.planInput, schemaItems)
  // Every production row this push writes or changes is locked and verified
  // before the schema and language writes, which bump content_version too.
  const lockedVersions = await lockAndVerifyAffected(tx, [
    ...entryItems,
    ...schemaItems,
  ])
  const devById = new Map(
    context.planInput.devEntries.map((row) => [row.id, row]),
  )
  assertUrlsFree(context.planInput, entryItems, devById)
  // The versions before any schema write, for the baselines written at the end.
  const beforeSchema = new Map(lockedVersions)

  const state: PushState = {
    tx,
    actor,
    organizationId,
    production: prod,
    planInput: context.planInput,
    warnings: [],
    targets: new Map(),
    written: new Map(),
    selectedIds: new Set(selected.map((item) => item.id)),
    lockedVersions,
  }

  // Schema first, then languages, so entries see the collections and languages they need.
  await pushSchema(state, schemaItems)
  if (languagesItem) {
    await pushLanguages(state)
    state.written.set(languagesItem.id, null)
  }
  for (const item of schemaItems) state.written.set(item.id, null)

  // The transaction's own schema and language writes moved some versions. The
  // rows stay locked, so the versions read now are the ones entries write over.
  state.lockedVersions = await readContentVersions(tx, [
    ...lockedVersions.keys(),
  ])

  // Re-read after the schema and languages writes.
  const productionCollections = await tx
    .select()
    .from(collection)
    .where(eq(collection.siteId, prod.id))
  const productionSite = await readSiteRow(tx, prod.id)

  const created = await pushEntriesPassOne(
    state,
    entryItems,
    devById,
    productionCollections,
  )
  const lookup = await productionReferenceLookup(
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
  await adjustUnwrittenBaselines(
    state,
    schemaItems,
    beforeSchema,
    context.planInput,
  )
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
      collectionKind: kinds.get(itemId) ?? null,
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
  /** Plan item ids the push writes (selected, after exclusions and decisions). */
  selectedIds: Set<string>
  /** Production entry id to its content_version, for the rows this push locked. */
  lockedVersions: Map<string, number>
}

/**
 * Fields an entry keeps in production: the ones a pending schema removal would
 * delete. Empty when that removal is applied in this push.
 */
function keptFields(item: PlanItem, selectedIds: Set<string>): string[] {
  const pending = (item.dependsOn ?? []).some((id) => !selectedIds.has(id))
  return pending ? (item.summary.preservedFields ?? []) : []
}

/**
 * The production schema as it will be after the selected schema items, checked
 * once before any write, so the order of the items does not matter (a new
 * collection may reference one that sorts after it). Untouched definitions
 * stay as they are; an applied removal is disabled, and keeps its rows.
 */
function checkResultingSchema(planInput: PlanInput, items: PlanItem[]) {
  const itemByKey = new Map(
    items.map((item) => [item.collectionKey ?? '', item]),
  )
  const production = planInput.production.collections
  const keys = [
    ...new Set([...production.map((def) => def.key), ...itemByKey.keys()]),
  ]
  const defs: ContentDefinition[] = []
  const declared: { key: string; kind: ContentDefinition['kind'] }[] = []
  for (const key of keys) {
    const item = itemByKey.get(key)
    const prod = production.find((def) => def.key === key)
    if (item?.kind === 'schema.remove') {
      if (prod) {
        defs.push({ key, kind: prod.kind, fields: prod.fields, enabled: false })
      }
      continue
    }
    if (item) {
      const dev = planInput.dev.collections.find((def) => def.key === key)
      if (!dev) {
        throw new ValidationError([
          { path: key, message: `Collection "${key}" is not in the dev env.` },
        ])
      }
      // The same checks and stored shape the writes use (a collection gets its slug field).
      let fields = dev.fields
      if (dev.kind === 'global') {
        prepareGlobalUpsert(globalInput(dev, []))
      } else {
        fields = prepareCollectionUpsert(collectionInput(dev, [])).fields
      }
      defs.push({ key, kind: dev.kind, fields, enabled: dev.enabled })
      declared.push({ key, kind: dev.kind })
      continue
    }
    if (prod) {
      defs.push({
        key,
        kind: prod.kind,
        fields: prod.fields,
        enabled: prod.enabled,
      })
    }
  }
  assertKindsUnchanged(production, declared)
  validateContentDefinitions(defs)
}

/**
 * Locks the production rows the selected items write or change, in id order,
 * and checks each `content_version` against the plan: entry items, and the
 * entries a destructive schema item affects. A production entry that these
 * writes touch must not be scheduled now, whatever the plan showed. Returns
 * the verified versions.
 */
async function lockAndVerifyAffected(
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
 * Apply-time check of the URLs the selected entries write, against the
 * production rows read under this transaction's locks. The plan flags the same
 * collisions (Apply is disabled for them), so this only catches a collision the
 * plan hash does not cover. Entries of the same push are checked against each
 * other too.
 */
function assertUrlsFree(
  planInput: PlanInput,
  items: PlanItem[],
  devById: Map<string, PlanEntry>,
) {
  const writes = items.flatMap((item) => {
    if (item.kind === 'entry.archive') return []
    const dev = item.devId ? devById.get(item.devId) : undefined
    return dev ? [{ item, dev }] : []
  })
  for (const write of writes) {
    const { item, dev } = write
    const production = planInput.productionEntries
      .filter(
        (row) =>
          row.collectionKey === dev.collectionKey &&
          row.id !== item.productionId,
      )
      .map(ownerOf)
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
    for (const [where, owners] of holdings) {
      const collision = findSlugCollisions(dev, owners).at(0)
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

async function readContentVersions(
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

async function pushSchema(state: PushState, items: PlanItem[]) {
  const { tx, production } = state
  // Adds and changes first, so a removal never leaves a reference dangling mid-push.
  const ordered = [
    ...items.filter((item) => item.kind !== 'schema.remove'),
    ...items.filter((item) => item.kind === 'schema.remove'),
  ]
  for (const item of ordered) {
    const key = item.collectionKey ?? ''
    const existing = (
      await tx
        .select({ id: collection.id })
        .from(collection)
        .where(
          and(eq(collection.siteId, production.id), eq(collection.key, key)),
        )
        .limit(1)
    ).at(0)

    if (item.kind === 'schema.remove') {
      // Disabled and archived, never deleted: production keeps the rows.
      if (existing) await disableAndArchive(state, existing.id)
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
    // The resulting schema was validated once in checkResultingSchema.
    if (devDef.kind === 'global') {
      const input = globalInput(devDef, confirmDropFields)
      await writeGlobalUpsert(
        tx,
        production.id,
        input,
        prepareGlobalUpsert(input),
        new Date(),
        { validated: true },
      )
    } else {
      const input = collectionInput(devDef, confirmDropFields)
      await writeCollectionUpsert(
        tx,
        production.id,
        input,
        prepareCollectionUpsert(input),
        new Date(),
        { validated: true },
      )
    }
  }
}

/**
 * A removal in dev disables the production collection or section and archives
 * its entries (status archived, content_version bumped). Rows are kept. The
 * baseline drops the key, and a disabled production collection counts as absent
 * in the plan, so the removal does not come back.
 */
async function disableAndArchive(state: PushState, collectionId: string) {
  const { tx, actor } = state
  const now = new Date()
  await tx
    .update(collection)
    .set({ enabled: false, updatedAt: now })
    .where(eq(collection.id, collectionId))
  await tx
    .update(entry)
    .set({
      status: 'archived',
      contentVersion: sql`${entry.contentVersion} + 1`,
      updatedBy: actor.id,
      updatedAt: now,
    })
    .where(eq(entry.collectionId, collectionId))
}

function globalInput(
  def: SchemaSnapshotItem,
  confirmDropFields: string[],
): GlobalInput {
  return {
    key: def.key,
    label: def.label,
    fields: def.fields,
    seo: def.seoEnabled,
    previewPath: def.previewPath,
    enabled: def.enabled,
    requiredLanguages: def.requiredLanguages,
    confirmDropFields,
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
    // Checked in lockAndVerifyAffected, then against this transaction's own writes.
    if (!isCreated && row.contentVersion !== state.lockedVersions.get(row.id)) {
      throw new ConflictError(PLAN_CHANGED_MESSAGE)
    }

    if (item.kind === 'entry.archive') {
      await keepDraftRevision(tx, row, actor.id)
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
    if (!isCreated) {
      await keepDraftRevision(tx, row, actor.id)
    }

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

/**
 * An applied field removal purges the removed values from the production
 * entries that hold them, and bumps their `content_version`. Dev entries of
 * those collections that this push did not write take the same change in their
 * baseline: the removed keys drop out, and the recorded production version
 * moves with the purge (only when the entry was not in conflict before it).
 * Without this, the removal would list those entries again after it is applied.
 */
async function adjustUnwrittenBaselines(
  state: PushState,
  schemaItems: PlanItem[],
  beforeSchema: Map<string, number>,
  planInput: PlanInput,
) {
  const { tx } = state
  const removedByKey = new Map<string, string[]>()
  for (const item of schemaItems) {
    if (item.kind !== 'schema.change' || !item.collectionKey) continue
    const keys = removedFieldKeysOf(planInput, item.collectionKey)
    if (keys.length > 0) removedByKey.set(item.collectionKey, keys)
  }
  if (removedByKey.size === 0) return
  for (const dev of planInput.devEntries) {
    const keys = removedByKey.get(dev.collectionKey)
    const base = dev.originBaseline
    if (!keys || !base || !dev.originEntryId) continue
    if (state.written.has(`entry:${dev.id}`)) continue
    const purgedVersion = beforeSchema.get(dev.originEntryId)
    const originVersion =
      purgedVersion !== undefined && purgedVersion === dev.originContentVersion
        ? (state.lockedVersions.get(dev.originEntryId) ??
          dev.originContentVersion)
        : dev.originContentVersion
    await tx
      .update(entry)
      .set({
        originBaseline: {
          ...base,
          data: withoutFieldKeys(base.data, keys),
          publishedData:
            base.publishedData == null
              ? null
              : withoutFieldKeys(base.publishedData, keys),
        },
        originContentVersion: originVersion,
      })
      .where(eq(entry.id, dev.id))
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
    const baseline = nextOriginBaseline(
      dev,
      readyPushed,
      keptFields(item, state.selectedIds),
    )
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
