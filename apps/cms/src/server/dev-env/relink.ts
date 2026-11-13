import { eq, inArray } from 'drizzle-orm'

import { collection, entry } from '#/db/schema'
import { stableStringify } from '#/lib/stable-json'
import type { EntryData } from '#/lib/types'
import {
  entryLinkIdsOf,
  linkTargetHref,
  loadLinkTargets,
  mapRichTextValues,
} from '#/server/content/entry-links'
import { relinkEntryLinks } from '#/server/richtext/entry-links'

import type { Tx } from '#/db'

/** A production entry after `relinkProductionEntries`: its data with the paths recomputed. */
export type RelinkedEntry = {
  id: string
  draftData: EntryData
  publishedData: EntryData | null
}

/**
 * Recomputes the stored path of every entry link in the given production
 * entries, from production's state inside `tx`. A link keeps the target's path
 * as it was when the dev entry was saved, so after a rename of a target that
 * was not copied, production would keep the stale path. Callers run this after
 * all writes of their transaction, so the target's slug is its final one.
 *
 * Writes only the entries whose links changed. Returns each entry's draft and
 * published data after the recompute, so the caller can validate a ready
 * version built from it.
 */
export async function relinkProductionEntries(
  tx: Tx,
  productionSiteId: string,
  entryIds: string[],
): Promise<RelinkedEntry[]> {
  const ids = [...new Set(entryIds)]
  if (ids.length === 0) return []
  const rows = await tx
    .select({
      id: entry.id,
      draftData: entry.draftData,
      publishedData: entry.publishedData,
      fields: collection.fields,
    })
    .from(entry)
    .innerJoin(collection, eq(entry.collectionId, collection.id))
    .where(inArray(entry.id, ids))

  const targetIds = new Set(
    rows.flatMap((row) => [
      ...entryLinkIdsOf([row.draftData, row.publishedData], row.fields),
    ]),
  )
  const targets = await loadLinkTargets(tx, productionSiteId, targetIds)
  const resolve = (target: { entryId: string; anchor: string | null }) => {
    const found = targets.get(target.entryId)
    return found ? linkTargetHref(found, target.anchor) : undefined
  }

  const relinked: RelinkedEntry[] = []
  for (const row of rows) {
    const relink = (data: EntryData) =>
      mapRichTextValues(data, row.fields, (json) =>
        relinkEntryLinks(json, resolve),
      )
    const draftData = relink(row.draftData)
    const publishedData = row.publishedData ? relink(row.publishedData) : null
    relinked.push({ id: row.id, draftData, publishedData })
    const changed =
      stableStringify(draftData) !== stableStringify(row.draftData) ||
      (publishedData !== null &&
        stableStringify(publishedData) !== stableStringify(row.publishedData))
    if (!changed) continue
    await tx
      .update(entry)
      .set({
        draftData,
        ...(publishedData ? { publishedData } : {}),
      })
      .where(eq(entry.id, row.id))
  }
  return relinked
}
