import { eq } from 'drizzle-orm'

import { PLAN_CHANGED_MESSAGE } from '#/lib/dev-env'
import { db } from '#/db'
import type { Tx } from '#/db'
import { collection, environmentPush } from '#/db/schema'
import { audit } from '#/server/audit'
import { lockOrganizationForMutation } from '#/server/admin/organization-lock'
import { assetExclusiveLock } from '#/server/assets/usage'
import { ConflictError } from '#/server/content/errors'
import {
  lockSiteLinkIndex,
  rebuildEntryLinkIndex,
  syncEntryLinkIndexes,
} from '#/server/content/entry-link-index'
import { getSiteOrThrow } from '#/server/content/site-core'
import { AppError } from '#/server/http/app-error'
import { requestPublication } from '#/server/publishing/publications'
import type { ContentKind } from '#/lib/types'

import { loadPlanContext } from './load-plan'
import { lockProductionSite } from './lock'
import { buildPlan, selectPlanItems } from './plan'
import { adjustUnwrittenBaselines, writeBaselines } from './push-baselines'
import {
  assertUrlsFree,
  lockAndVerifyAffected,
  pushEntriesPassOne,
  pushEntriesPassTwo,
  readContentVersions,
  relinkWrittenEntries,
  resolveReadyCandidates,
} from './push-entries'
import {
  checkResultingSchema,
  pushLanguages,
  pushSchema,
  writeSchemaBaseline,
} from './push-schema'
import type { PushState } from './push-state'
import {
  lockDevEnvironment,
  lockProductionRow,
  readDevEnvironment,
} from './rows'
import type { DevEnvActor } from './rows'
import { productionReferenceLookup } from './write'
import type { PushCounts, PushWarning } from './write'

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
    runPush(tx, actor, input, probe.organizationId, probe.parentSiteId),
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
  /** The production site the push writes. Fixed for a dev env, so read before the transaction. */
  productionSiteId: string,
): Promise<CommittedPush> {
  // Link-index lock first, before any row lock (see `lockSiteLinkIndex`).
  await lockSiteLinkIndex(tx, productionSiteId)
  await lockOrganizationForMutation(tx, organizationId, {
    mode: 'no-key-update',
  })
  const dev = await lockDevEnvironment(tx, input.devSiteId)
  const prod = await lockProductionRow(tx, dev.parentSiteId)
  await lockProductionSite(tx, prod.id)
  // The lock ordinary entry saves take (server/content/entries.ts), last in the
  // order, so the URLs read below cannot change under this push.
  await assetExclusiveLock(tx, organizationId)

  const context = await loadPlanContext(tx, dev.id)
  const plan = buildPlan(context.planInput)
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
  // before the schema and language writes, which bump content_version too: the
  // entries a selected schema or main-language item affects are in that set.
  const lockedVersions = await lockAndVerifyAffected(tx, [
    ...entryItems,
    ...schemaItems,
    ...(languagesItem ? [languagesItem] : []),
  ])
  const devById = new Map(
    context.planInput.devEntries.map((row) => [row.id, row]),
  )
  await assertUrlsFree(tx, prod.id, entryItems, devById)
  // The versions before any write, for the baselines of entries this push leaves alone.
  const beforeWrites = new Map(lockedVersions)

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
  const productionSite = await getSiteOrThrow(prod.id, tx)

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
  // Every target has its final slug now: the links the push wrote follow it.
  await relinkWrittenEntries(state, candidates)
  await resolveReadyCandidates(tx, productionSite, candidates, state.warnings)

  await writeBaselines(state, entryItems, devById, candidates)
  await adjustUnwrittenBaselines(
    state,
    schemaItems,
    beforeWrites,
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

  // The link index follows the entries this push wrote. A schema or language
  // change can reshape any entry's rows, so it rebuilds the site instead.
  if (schemaItems.length > 0 || languagesItem) {
    await rebuildEntryLinkIndex(tx, productionSite.id)
  } else {
    const written = [...state.written.values()].filter(
      (id): id is string => id !== null,
    )
    await syncEntryLinkIndexes(tx, written)
  }

  return {
    counts,
    warnings: state.warnings,
    written: [...state.written].map(([itemId, productionId]) => ({
      itemId,
      productionId,
      collectionKind: itemId.startsWith('entry:')
        ? (devById.get(itemId.slice('entry:'.length))?.collectionKind ?? null)
        : null,
    })),
    productionSiteId: prod.id,
  }
}
