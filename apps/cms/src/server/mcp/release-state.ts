import { diffApprovedRelease } from '#/server/publishing/release-diff'

import type { ReleaseState } from './release-flags'

export type { ReleaseFlags, ReleaseState } from './release-flags'
export { releaseFlags } from './release-flags'

/**
 * Loads which entries are live and which have approved changes waiting for the
 * next go live. It builds the candidate snapshot, so call it once per tool
 * call and apply the result to every entry that call returns.
 */
export async function loadReleaseState(siteId: string): Promise<ReleaseState> {
  const diff = await diffApprovedRelease(siteId)
  const pending = [
    ...diff.adds,
    ...diff.updates,
    ...diff.removals,
    ...diff.scheduledUpcoming,
  ]
  return {
    liveIds: new Set(diff.liveEntryIds),
    pendingIds: new Set(pending.map((item) => item.id)),
  }
}
