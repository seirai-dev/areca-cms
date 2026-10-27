import type { EntryUiStatus } from '#/lib/status'
import type { EntryStatus } from '#/lib/types'

export type EntryLike = {
  id?: string
  status: EntryStatus
  updatedAt: string | Date
  scheduledAt?: string | Date | null
  draftData?: unknown
  publishedData?: unknown
  publishedSlug?: string | null
  slug?: string
}

export type LiveMembership =
  | {
      liveEntryIds: readonly string[]
      liveSlugsByEntryId: Readonly<Record<string, string>>
      pendingEntryIds?: readonly string[]
    }
  | null
  | undefined

/** Order-insensitive JSON for comparing draft and published data. */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`,
      )
      .join(',')}}`
  }
  return JSON.stringify(value ?? null)
}

function approvedSlug(entry: EntryLike) {
  return entry.publishedSlug ?? entry.slug ?? null
}

/**
 * Draft → Ready → Live (brief §1.2), from backend truth:
 *
 * - draft/scheduled/archived map straight through;
 * - published is **Ready** when nothing is live, or the live snapshot does
 *   not contain this entry id with the same approved slug, or the approved
 *   version is still pending (add/update); otherwise **Live**.
 *
 * `live` is snapshot membership from `useReleaseStatus`. While it is still
 * loading (`undefined`), published entries read as Live.
 *
 * A development environment (`devSite`) has no releases, so a published entry
 * is always Ready there: it is never Live and never pending a release.
 */
export function entryUiStatus(
  entry: EntryLike,
  live: LiveMembership,
  devSite = false,
): EntryUiStatus {
  switch (entry.status) {
    case 'draft':
      return 'draft'
    case 'scheduled':
      return 'scheduled'
    case 'archived':
      return 'archived'
    case 'published': {
      if (devSite) return 'ready'
      if (live === undefined) return 'live'
      if (live === null) return 'ready'
      if (!entry.id || !live.liveEntryIds.includes(entry.id)) return 'ready'
      const slug = approvedSlug(entry)
      if (slug != null && live.liveSlugsByEntryId[entry.id] !== slug) {
        return 'ready'
      }
      if (live.pendingEntryIds?.includes(entry.id)) return 'ready'
      return 'live'
    }
  }
}

/**
 * A published entry whose draft differs from what was marked ready
 * ("Edited since ready"). Needs both `draftData` and `publishedData`.
 */
export function isEditedSinceReady(entry: EntryLike) {
  if (entry.status !== 'published') return false
  if (entry.draftData === undefined || entry.publishedData == null) return false
  return stable(entry.draftData) !== stable(entry.publishedData)
}

export type EntryLiveState = {
  status: EntryUiStatus
  editedSinceReady: boolean
  scheduledAt: string | Date | null
}

/**
 * The pill state of an entry. A development environment has no releases, so
 * it never shows the "unreleased changes" dot either.
 */
export function entryLiveState(
  entry: EntryLike,
  live: LiveMembership,
  devSite = false,
): EntryLiveState {
  return {
    status: entryUiStatus(entry, live, devSite),
    editedSinceReady: !devSite && isEditedSinceReady(entry),
    scheduledAt: entry.scheduledAt ?? null,
  }
}
