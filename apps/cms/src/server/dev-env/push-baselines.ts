/** The origin-baseline steps of a push, for the dev entries it wrote and the ones it left. */
import { eq, inArray } from 'drizzle-orm'

import { entry } from '#/db/schema'
import { withoutFieldKeys } from '#/lib/field-content'

import { removedFieldKeysOf } from './plan'
import type { PlanEntry, PlanInput, PlanItem } from './plan'
import { keptFields } from './push-state'
import type { PushState, ReadyCandidate } from './push-state'
import { nextOriginBaseline } from './write'

/**
 * Dev entries this push did not write, that are linked to production, follow the
 * changes the push made to their production rows. Own bumps are not a conflict:
 * an entry that was in step with production before the push (its recorded
 * `origin_content_version` is the one read before any write) takes the version
 * the push left it at. An applied field removal also drops the removed keys from
 * its baseline. Without this, the entry would be listed again after the push.
 */
export async function adjustUnwrittenBaselines(
  state: PushState,
  schemaItems: PlanItem[],
  beforeWrites: Map<string, number>,
  planInput: PlanInput,
) {
  const { tx } = state
  const removedByKey = new Map<string, string[]>()
  for (const item of schemaItems) {
    if (item.kind !== 'schema.change' || !item.collectionKey) continue
    const keys = removedFieldKeysOf(planInput, item.collectionKey)
    if (keys.length > 0) removedByKey.set(item.collectionKey, keys)
  }
  for (const dev of planInput.devEntries) {
    const base = dev.originBaseline
    if (!base || !dev.originEntryId) continue
    if (state.written.has(`entry:${dev.id}`)) continue
    const keys = removedByKey.get(dev.collectionKey) ?? []
    const before = beforeWrites.get(dev.originEntryId)
    const inStep = before !== undefined && before === dev.originContentVersion
    const originVersion = inStep
      ? (state.lockedVersions.get(dev.originEntryId) ??
        dev.originContentVersion)
      : dev.originContentVersion
    if (keys.length === 0 && originVersion === dev.originContentVersion) {
      continue
    }
    await tx
      .update(entry)
      .set({
        originBaseline:
          keys.length === 0
            ? base
            : {
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
export async function writeBaselines(
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
