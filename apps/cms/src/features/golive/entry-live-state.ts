import type { EntryUiStatus } from '#/lib/status'
import type { EntryStatus } from '#/lib/types'

import type { ReleaseStatusData } from './queries'

export type EntryLike = {
  status: EntryStatus
  updatedAt: string | Date
  scheduledAt?: string | Date | null
  draftData?: unknown
  publishedData?: unknown
}

type LiveLike =
  | Pick<NonNullable<ReleaseStatusData['live']>, 'createdAt'>
  | null
  | undefined

function time(value: string | Date) {
  return value instanceof Date ? value.getTime() : new Date(value).getTime()
}

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

/**
 * Draft → Ready → Live (brief §1.2), from backend truth:
 *
 * - draft/scheduled/archived map straight through;
 * - published is **Ready** while nothing is live, or when the entry changed
 *   after the live release was created; otherwise **Live**.
 *
 * `live` is the site's live publication (from `useReleaseStatus`). While it
 * is still loading (`undefined`), published entries read as Live.
 */
export function entryUiStatus(entry: EntryLike, live: LiveLike): EntryUiStatus {
  switch (entry.status) {
    case 'draft':
      return 'draft'
    case 'scheduled':
      return 'scheduled'
    case 'archived':
      return 'archived'
    case 'published': {
      if (live === undefined) return 'live'
      if (live === null) return 'ready'
      return time(entry.updatedAt) > time(live.createdAt) ? 'ready' : 'live'
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

export function entryLiveState(entry: EntryLike, live: LiveLike): EntryLiveState {
  return {
    status: entryUiStatus(entry, live),
    editedSinceReady: isEditedSinceReady(entry),
    scheduledAt: entry.scheduledAt ?? null,
  }
}
