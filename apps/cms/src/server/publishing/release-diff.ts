import { and, desc, eq, gt, inArray } from 'drizzle-orm'

import { db } from '#/db'
import { collection, entry, publication, site, user } from '#/db/schema'
import { entryTitle } from '#/lib/content/utils'
import type { Field, Snapshot, SnapshotEntry } from '#/lib/types'
import { buildSnapshot } from '#/server/content/snapshot'

/**
 * Approved-candidate vs live (or demo) snapshot.
 *
 * Callers see counts, membership, and panel rows. Inclusion, scheduling
 * freeze, and conversion stay in `buildSnapshot` — this module only diffs.
 *
 * Building the candidate snapshot does the same work as a Go-live request
 * (validation, asset/rich-text conversion). Status polling therefore costs
 * a full snapshot build, not a `updatedAt` count.
 */

export type ReleaseDiffEntry = {
  id: string
  slug: string
  collectionKey: string
  data: Record<string, unknown>
}

export type ScheduledUpcoming = {
  id: string
  slug: string
  collectionKey: string
  scheduledAt: Date
  data: Record<string, unknown>
}

export type ApprovedReleaseDiff = {
  pendingCount: number
  adds: ReleaseDiffEntry[]
  updates: ReleaseDiffEntry[]
  removals: ReleaseDiffEntry[]
  scheduledUpcoming: ScheduledUpcoming[]
  liveEntryIds: string[]
  liveSlugsByEntryId: Record<string, string>
}

export type PendingReleaseChange = {
  id: string
  title: string
  slug: string
  collectionKey: string
  collectionLabel: string
  updatedAt: string | Date
  updatedByName: string | null
  scheduledAt: string | Date | null
  kind: 'ready' | 'scheduled' | 'removal'
  exists: boolean
}

type IndexedEntry = ReleaseDiffEntry & { seo?: SnapshotEntry['seo'] }

/** Order-insensitive JSON; same rule as `entry-live-state` `stable()`. */
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`,
      )
      .join(',')}}`
  }
  return JSON.stringify(value ?? null)
}

function fingerprint(entry: Pick<SnapshotEntry, 'id' | 'slug' | 'data'>) {
  return `${entry.id}\0${entry.slug}\0${stableJson(entry.data)}`
}

/** Resolved SEO minus the publish dates, which follow `publishedAt`. */
function seoFingerprint(seo: SnapshotEntry['seo']) {
  if (!seo) return null
  return stableJson({
    ...seo,
    openGraph: { ...seo.openGraph, publishedTime: null, modifiedTime: null },
    jsonLd: seo.jsonLd.map(
      ({ datePublished: _p, dateModified: _m, ...rest }) => rest,
    ),
  })
}

function withoutSeoKey({
  seo: _seo,
  ...rest
}: IndexedEntry): ReleaseDiffEntry {
  return rest
}

function changed(next: IndexedEntry, prev: IndexedEntry) {
  if (fingerprint(next) !== fingerprint(prev)) return true
  // Publications built before SEO existed carry no `seo`: not a change.
  const a = seoFingerprint(next.seo)
  const b = seoFingerprint(prev.seo)
  return a !== null && b !== null && a !== b
}

/**
 * Pending is adds+updates+removals when the candidate snapshot built.
 * A failed candidate must not look “up to date” if a live/demo baseline exists.
 */
export function pendingCountFromDiff(input: {
  candidateOk: boolean
  hasBaseline: boolean
  adds: number
  updates: number
  removals: number
}) {
  if (!input.candidateOk) return input.hasBaseline ? 1 : 0
  return input.adds + input.updates + input.removals
}

function indexCollections(
  collections: Record<string, SnapshotEntry[]> | null | undefined,
): Map<string, IndexedEntry> {
  const byId = new Map<string, IndexedEntry>()
  if (!collections) return byId
  for (const [collectionKey, items] of Object.entries(collections)) {
    for (const item of items) {
      byId.set(item.id, {
        id: item.id,
        slug: item.slug,
        collectionKey,
        data: item.data,
        seo: item.seo,
      })
    }
  }
  return byId
}

/**
 * Diff two snapshot `collections` maps by entry id.
 * Missing in live = add; missing in candidate = removal; same id but slug
 * or stable(data) differs = update. `publishedAt` is ignored.
 */
export function diffSnapshotCollections(
  candidate: Record<string, SnapshotEntry[]> | null | undefined,
  live: Record<string, SnapshotEntry[]> | null | undefined,
): Pick<ApprovedReleaseDiff, 'adds' | 'updates' | 'removals'> {
  const next = indexCollections(candidate)
  const prev = indexCollections(live)
  const adds: ReleaseDiffEntry[] = []
  const updates: ReleaseDiffEntry[] = []
  const removals: ReleaseDiffEntry[] = []

  for (const [id, item] of next) {
    const existing = prev.get(id)
    if (!existing) {
      adds.push(withoutSeoKey(item))
      continue
    }
    if (changed(item, existing)) updates.push(withoutSeoKey(item))
  }
  for (const [id, item] of prev) {
    if (!next.has(id)) removals.push(withoutSeoKey(item))
  }

  return { adds, updates, removals }
}

async function latestPublication(
  siteId: string,
  status: 'live' | 'demo',
): Promise<typeof publication.$inferSelect | null> {
  const [row] = await db
    .select()
    .from(publication)
    .where(and(eq(publication.siteId, siteId), eq(publication.status, status)))
    .orderBy(desc(publication.createdAt))
    .limit(1)
  return row ?? null
}

function comparisonSnapshot(
  publishingMode: 'production' | 'demo',
  live: typeof publication.$inferSelect | null,
  demo: typeof publication.$inferSelect | null,
): Snapshot | null {
  if (live) return live.snapshot
  if (publishingMode === 'demo' && demo) return demo.snapshot
  return null
}

async function listScheduledUpcoming(
  siteId: string,
  pendingIds: Set<string>,
): Promise<ScheduledUpcoming[]> {
  const now = new Date()
  const rows = await db
    .select({
      id: entry.id,
      slug: entry.slug,
      publishedSlug: entry.publishedSlug,
      scheduledSlug: entry.scheduledSlug,
      scheduledAt: entry.scheduledAt,
      scheduledData: entry.scheduledData,
      publishedData: entry.publishedData,
      draftData: entry.draftData,
      collectionKey: collection.key,
    })
    .from(entry)
    .innerJoin(collection, eq(entry.collectionId, collection.id))
    .where(
      and(
        eq(entry.siteId, siteId),
        eq(entry.status, 'scheduled'),
        gt(entry.scheduledAt, now),
      ),
    )

  const upcoming: ScheduledUpcoming[] = []
  for (const row of rows) {
    if (pendingIds.has(row.id)) continue
    if (!row.scheduledAt) continue
    upcoming.push({
      id: row.id,
      slug: row.scheduledSlug ?? row.publishedSlug ?? row.slug,
      collectionKey: row.collectionKey,
      scheduledAt: row.scheduledAt,
      data: (row.scheduledData ?? row.publishedData ?? row.draftData) as Record<
        string,
        unknown
      >,
    })
  }
  return upcoming
}

export async function diffApprovedRelease(
  siteId: string,
): Promise<ApprovedReleaseDiff> {
  const [existingSite] = await db
    .select()
    .from(site)
    .where(eq(site.id, siteId))
    .limit(1)
  const publishingMode = existingSite?.publishingMode ?? 'production'
  const live = await latestPublication(siteId, 'live')
  const demo =
    publishingMode === 'demo' ? await latestPublication(siteId, 'demo') : null
  const baseline = comparisonSnapshot(publishingMode, live, demo)
  const liveIndex = indexCollections(baseline?.collections)

  const built = await buildSnapshot(siteId)
  const candidate = built.ok ? built.snapshot.collections : null
  const { adds, updates, removals } = built.ok
    ? diffSnapshotCollections(candidate, baseline?.collections)
    : { adds: [], updates: [], removals: [] }

  const pendingIds = new Set(
    [...adds, ...updates, ...removals].map((item) => item.id),
  )
  const scheduledUpcoming = await listScheduledUpcoming(siteId, pendingIds)

  const liveSlugsByEntryId: Record<string, string> = {}
  for (const [id, item] of liveIndex) liveSlugsByEntryId[id] = item.slug

  return {
    pendingCount: pendingCountFromDiff({
      candidateOk: built.ok,
      hasBaseline: Boolean(baseline),
      adds: adds.length,
      updates: updates.length,
      removals: removals.length,
    }),
    adds,
    updates,
    removals,
    scheduledUpcoming,
    liveEntryIds: [...liveIndex.keys()],
    liveSlugsByEntryId,
  }
}

function titleOf(
  data: Record<string, unknown>,
  fields: Field[] | undefined,
  slug: string,
) {
  return entryTitle(data, fields ?? [], slug)
}

export async function listPendingReleaseChanges(
  siteId: string,
): Promise<PendingReleaseChange[]> {
  const diff = await diffApprovedRelease(siteId)
  const collections = await db
    .select({
      key: collection.key,
      label: collection.label,
      fields: collection.fields,
    })
    .from(collection)
    .where(eq(collection.siteId, siteId))
  const byKey = new Map(collections.map((col) => [col.key, col]))

  const ids = [
    ...diff.adds,
    ...diff.updates,
    ...diff.removals,
    ...diff.scheduledUpcoming,
  ].map((item) => item.id)
  const rows =
    ids.length === 0
      ? []
      : await db
          .select({
            id: entry.id,
            slug: entry.slug,
            updatedAt: entry.updatedAt,
            scheduledAt: entry.scheduledAt,
            updatedByName: user.name,
          })
          .from(entry)
          .leftJoin(user, eq(entry.updatedBy, user.id))
          .where(and(eq(entry.siteId, siteId), inArray(entry.id, ids)))
  const byId = new Map(rows.map((row) => [row.id, row]))

  const changes: PendingReleaseChange[] = []

  const pushReady = (item: ReleaseDiffEntry, kind: 'ready' | 'removal') => {
    const col = byKey.get(item.collectionKey)
    const row = byId.get(item.id)
    changes.push({
      id: item.id,
      title: titleOf(item.data, col?.fields, item.slug),
      slug: item.slug,
      collectionKey: item.collectionKey,
      collectionLabel: col?.label ?? item.collectionKey,
      updatedAt: row?.updatedAt ?? new Date(0),
      updatedByName: row?.updatedByName ?? null,
      scheduledAt: row?.scheduledAt ?? null,
      kind,
      exists: Boolean(row),
    })
  }

  for (const item of diff.adds) pushReady(item, 'ready')
  for (const item of diff.updates) pushReady(item, 'ready')
  for (const item of diff.removals) pushReady(item, 'removal')

  for (const item of diff.scheduledUpcoming) {
    const col = byKey.get(item.collectionKey)
    const row = byId.get(item.id)
    changes.push({
      id: item.id,
      title: titleOf(item.data, col?.fields, item.slug),
      slug: item.slug,
      collectionKey: item.collectionKey,
      collectionLabel: col?.label ?? item.collectionKey,
      updatedAt: row?.updatedAt ?? item.scheduledAt,
      updatedByName: row?.updatedByName ?? null,
      scheduledAt: item.scheduledAt,
      kind: 'scheduled',
      exists: Boolean(row),
    })
  }

  changes.sort((a, b) => {
    const rank = { ready: 0, removal: 1, scheduled: 2 }
    if (rank[a.kind] !== rank[b.kind]) return rank[a.kind] - rank[b.kind]
    if (a.kind === 'scheduled') {
      return (
        new Date(a.scheduledAt ?? 0).getTime() -
        new Date(b.scheduledAt ?? 0).getTime()
      )
    }
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  })

  return changes
}
