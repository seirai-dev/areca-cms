import { createServerFn } from '@tanstack/react-start'
import { eq, inArray, sql } from 'drizzle-orm'

import { db } from '#/db'
import { collection, entry } from '#/db/schema'
import { ACTIVITY_ENTRIES_MAX_IDS, ID_MAX_LENGTH } from '#/lib/content-limits'
import { GLOBAL_ENTRY_SLUG } from '#/lib/globals'
import { requireUser } from '#/lib/session.server'
import { z } from '#/lib/zod'
import type { EntryData } from '#/lib/types'
import { requireSiteAccess } from '#/server/content/access'
import { NotFoundError } from '#/server/content/errors'

const activityFn = { strict: { output: false } as const }

/** A readable title from entry data, without its schema (the feed's rule). */
/** The draft keys a title is taken from, in order. Only these are read. */
const TITLE_KEYS = ['title', 'name', 'heading', 'label']

function titleOf(data: EntryData | null | undefined) {
  if (!data) return null
  for (const key of TITLE_KEYS) {
    const value = data[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

/**
 * Whether the site can be read by the caller. `requireSiteAccess` answers
 * NotFound for a missing site, another tenant's site and a hidden dev site;
 * those are omitted here, not reported, so one bad id does not fail the page.
 */
async function canReadSite(siteId: string) {
  try {
    await requireSiteAccess(siteId)
    return true
  } catch (error) {
    if (error instanceof NotFoundError) return false
    throw error
  }
}

/**
 * Batched lookup of the entries an activity page mentions: one query for the
 * entries and their collections, one access check per distinct site. Applies
 * the rules `getEntryFn` applies per id:
 *
 * - a disabled site section is hidden from everyone but agency admins
 *   (mirrors `isHiddenSectionEntry`, inlined to avoid one query per row);
 * - the site must be readable by the caller (`requireSiteAccess`).
 *
 * Missing, foreign and hidden ids are left out of the result; the caller
 * falls back to the slug for them, as it did for a NotFound.
 */
export const getActivityEntriesFn = createServerFn({
  method: 'GET',
  ...activityFn,
})
  .validator(
    z.object({
      ids: z
        .array(z.string().min(1).max(ID_MAX_LENGTH))
        .max(ACTIVITY_ENTRIES_MAX_IDS),
    }),
  )
  .handler(async ({ data }) => {
    const viewer = await requireUser()
    const ids = [...new Set(data.ids)]
    if (ids.length === 0) return []

    const rows = await db
      .select({
        id: entry.id,
        siteId: entry.siteId,
        slug: entry.slug,
        draftData: sql<EntryData>`jsonb_build_object(${sql.join(
          TITLE_KEYS.map(
            (key) => sql`${key}::text, ${entry.draftData} -> ${key}`,
          ),
          sql`, `,
        )})`,
        collectionKey: collection.key,
        collectionKind: collection.kind,
        collectionEnabled: collection.enabled,
      })
      .from(entry)
      .innerJoin(collection, eq(entry.collectionId, collection.id))
      .where(inArray(entry.id, ids))

    const siteIds = [...new Set(rows.map((row) => row.siteId))]
    const readable = new Map<string, boolean>()
    for (const siteId of siteIds) {
      readable.set(siteId, await canReadSite(siteId))
    }

    return rows
      .filter((row) => {
        if (!readable.get(row.siteId)) return false
        const hidden =
          row.collectionKind === 'global' &&
          !row.collectionEnabled &&
          !viewer.user.isAgencyAdmin
        return !hidden
      })
      .map((row) => ({
        id: row.id,
        siteId: row.siteId,
        collectionKey: row.collectionKey,
        global: row.slug === GLOBAL_ENTRY_SLUG,
        title: titleOf(row.draftData),
      }))
  })
