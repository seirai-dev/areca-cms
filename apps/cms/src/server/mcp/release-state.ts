/* eslint-disable @typescript-eslint/no-unnecessary-condition -- publication lookup may return no row at runtime */
import { getLivePublication } from '#/server/publishing/publications'
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
  const [diff, live] = await Promise.all([
    diffApprovedRelease(siteId),
    getLivePublication(siteId),
  ])
  const pending = [
    ...diff.adds,
    ...diff.updates,
    ...diff.removals,
    ...diff.scheduledUpcoming,
  ]
  return {
    liveSnapshot: live?.snapshot ?? null,
    liveIds: new Set([
      ...Object.values(live?.snapshot.collections ?? {}).flatMap((items) =>
        items.map((item) => item.id),
      ),
      ...Object.values(live?.snapshot.globals ?? {}).map((item) => item.id),
    ]),
    pendingIds: new Set(pending.map((item) => item.id)),
  }
}
