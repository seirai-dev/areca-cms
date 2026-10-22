import { and, desc, eq, gt, inArray } from 'drizzle-orm'

import { db } from '#/db'
import { collection, entry, publication, site, user } from '#/db/schema'
import { entryTitle } from '#/lib/content/utils'
import { globalsAsEntryLists } from '#/lib/globals'
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
  /** A site content section: links to its section editor, not a collection. */
  global: boolean
}

type IndexedEntry = ReleaseDiffEntry &
  Pick<SnapshotEntry, 'seo' | 'publishedAt'>

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

function fingerprint(item: Pick<SnapshotEntry, 'id' | 'slug' | 'data'>) {
  return `${item.id}\0${item.slug}\0${stableJson(item.data)}`
}

/** Resolved SEO minus the publish dates, which follow `publishedAt`. */
function seoFingerprint(seo: SnapshotEntry['seo']) {
  if (!seo) return null
  return stableJson({
    ...seo,
    openGraph: { ...seo.openGraph, publishedTime: null, modifiedTime: null },
    jsonLd: seo.jsonLd.map((node, index) => {
      // The resolver puts the generated main node first; later nodes may
      // contain editor-supplied dates that are meaningful content changes.
      if (index !== 0) return node
      const { datePublished: _p, dateModified: _m, ...rest } = node
      return rest
    }),
  })
}

function withoutSeoKey({
  seo: _seo,
  publishedAt: _publishedAt,
  ...rest
}: IndexedEntry): ReleaseDiffEntry {
  return rest
}

function changed(next: IndexedEntry, prev: IndexedEntry) {
  if (fingerprint(next) !== fingerprint(prev)) return true
  const a = seoFingerprint(next.seo)
  const b = seoFingerprint(prev.seo)
  // Adding resolved defaults to an untouched legacy entry is not a change.
  // Re-approval advances publishedAt, so its SEO must be released even when
  // the live baseline predates SEO and has no metadata to compare.
  if (a !== null && b === null) {
    return next.publishedAt !== prev.publishedAt
  }
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

/**
 * Collections and site content sections keyed alike, so a release diff treats
 * a section like any other content item. Null when there is no snapshot.
 */
function releaseContent(
  snapshot: Pick<Snapshot, 'collections' | 'globals'> | null | undefined,
): Record<string, SnapshotEntry[]> | null {
  if (!snapshot) return null
  return {
    ...snapshot.collections,
    ...globalsAsEntryLists(snapshot.globals),
  }
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
        publishedAt: item.publishedAt,
      })
    }
  }
  return byId
}

/**
 * Diff two snapshot `collections` maps by entry id.
 * Missing in live = add; missing in candidate = removal; same id but slug
 * or stable(data)/SEO differs = update. `publishedAt` only distinguishes
 * re-approved entries from untouched entries when live SEO is missing.
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
  const row = (await db
    .select()
    .from(publication)
    .where(and(eq(publication.siteId, siteId), eq(publication.status, status)))
    .orderBy(desc(publication.createdAt))
    .limit(1)).at(0)
  return row ?? null
}

export function comparisonSnapshot(
  publishingMode: 'production' | 'demo',
  live: typeof publication.$inferSelect | null,
  demo: typeof publication.$inferSelect | null,
): Snapshot | null {
  return publishingMode === 'demo'
    ? (demo?.snapshot ?? null)
    : (live?.snapshot ?? null)
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
      collectionKind: collection.kind,
      collectionEnabled: collection.enabled,
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
    // A disabled section never ships, so it is not upcoming for anyone.
    if (row.collectionKind === 'global' && !row.collectionEnabled) continue
    if (!row.scheduledAt) continue
    upcoming.push({
      id: row.id,
      slug: row.scheduledSlug ?? row.publishedSlug ?? row.slug,
      collectionKey: row.collectionKey,
      scheduledAt: row.scheduledAt,
      data: row.scheduledData ?? row.publishedData ?? row.draftData,
    })
  }
  return upcoming
}

export async function diffApprovedRelease(
  siteId: string,
): Promise<ApprovedReleaseDiff> {
  const existingSite = (await db
    .select()
    .from(site)
    .where(eq(site.id, siteId))
    .limit(1)).at(0)
  const publishingMode = existingSite?.publishingMode ?? 'production'
  const live = await latestPublication(siteId, 'live')
  const demo =
    publishingMode === 'demo' ? await latestPublication(siteId, 'demo') : null
  const baseline = comparisonSnapshot(publishingMode, live, demo)
  const baselineContent = releaseContent(baseline)
  const liveIndex = indexCollections(baselineContent)

  // Blocked sections (never ready) must not hide the other changes; the
  // Go-live request itself still builds without this option and refuses.
  const built = await buildSnapshot(siteId, db, {
    allowNeverReadySections: true,
  })
  const candidate = built.ok ? releaseContent(built.snapshot) : null
  const { adds, updates, removals } = built.ok
    ? diffSnapshotCollections(candidate, baselineContent)
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

/** A section has no entry title of its own, so its label names the change. */
function titleOf(
  data: Record<string, unknown>,
  col: { kind: string; label: string; fields: Field[] } | undefined,
  slug: string,
) {
  if (col?.kind === 'global') return col.label
  return entryTitle(data, col?.fields ?? [], slug)
}

export async function listPendingReleaseChanges(
  siteId: string,
): Promise<PendingReleaseChange[]> {
  const diff = await diffApprovedRelease(siteId)
  const collections = await db
    .select({
      key: collection.key,
      kind: collection.kind,
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
      title: titleOf(item.data, col, item.slug),
      slug: item.slug,
      collectionKey: item.collectionKey,
      collectionLabel: col?.label ?? item.collectionKey,
      updatedAt: row?.updatedAt ?? new Date(0),
      updatedByName: row?.updatedByName ?? null,
      scheduledAt: row?.scheduledAt ?? null,
      kind,
      exists: Boolean(row),
      global: col?.kind === 'global',
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
      title: titleOf(item.data, col, item.slug),
      slug: item.slug,
      collectionKey: item.collectionKey,
      collectionLabel: col?.label ?? item.collectionKey,
      updatedAt: row?.updatedAt ?? item.scheduledAt,
      updatedByName: row?.updatedByName ?? null,
      scheduledAt: item.scheduledAt,
      kind: 'scheduled',
      exists: Boolean(row),
      global: col?.kind === 'global',
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
