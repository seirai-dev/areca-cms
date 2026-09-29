import { useMemo } from 'react'

import { entryLiveState } from './entry-live-state'
import type { EntryLike, EntryLiveState } from './entry-live-state'
import type { ReleaseStatus } from './use-release-status'
import type { ReleaseStatusData } from './queries'

/**
 * The UI status of one entry for pills, filters and the editor:
 *
 *   const release = useReleaseStatus(siteId)
 *   const { status, editedSinceReady, scheduledAt } =
 *     useEntryLiveState(entry, release)
 *   <EntryStatusPill status={status} editedSinceReady={editedSinceReady}
 *     scheduledAt={scheduledAt} />
 *
 * Accepts the `useReleaseStatus` result or the raw status payload. For lists
 * call `entryLiveState(entry, release.data?.live)` per row instead.
 */
export function useEntryLiveState(
  entry: EntryLike | null | undefined,
  releaseStatus: ReleaseStatus | ReleaseStatusData | null | undefined,
): EntryLiveState | null {
  const live =
    releaseStatus == null
      ? undefined
      : 'state' in releaseStatus
        ? releaseStatus.data
          ? releaseStatus.data.live
          : undefined
        : releaseStatus.live
  return useMemo(
    () => (entry ? entryLiveState(entry, live) : null),
    [entry, live],
  )
}
