import type { EntryUiStatus } from '#/lib/status'
import { isEditedSinceReady } from '#/lib/content/edited-since-ready'
import type { EntryStatus } from '#/lib/types'

export { isEditedSinceReady }

export type EntryLike = {
  id?: string
  status: EntryStatus
  updatedAt: string | Date
  scheduledAt?: string | Date | null
  draftData?: unknown
  publishedData?: unknown
  publishedSlug?: string | null
  slug?: string
  /**
   * Set by a list summary, which carries no draft or published data. When
   * absent, it is computed from `draftData` and `publishedData`.
   */
  editedSinceReady?: boolean
}

export type LiveMembership =
  | {
      liveEntryIds: readonly string[]
      liveSlugsByEntryId: Readonly<Record<string, string>>
      pendingEntryIds?: readonly string[]
    }
  | null
  | undefined

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
    editedSinceReady:
      !devSite && (entry.editedSinceReady ?? isEditedSinceReady(entry)),
    scheduledAt: entry.scheduledAt ?? null,
  }
}
