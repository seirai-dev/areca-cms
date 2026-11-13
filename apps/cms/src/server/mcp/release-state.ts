import { inArray } from 'drizzle-orm'

import { db } from '#/db'
import { site } from '#/db/schema'
import { isDevSite } from '#/lib/site-environment'
import { m } from '#/paraglide/messages'
import { NotFoundError } from '#/server/content/errors'
import { getLivePublication } from '#/server/publishing/publications'
import { approvedReleaseDiffs } from '#/server/publishing/release-diff'
import type { ApprovedReleaseDiff } from '#/server/publishing/release-diff'

import { NO_RELEASE_STATE } from './release-flags'
import type { ReleaseState } from './release-flags'

export type { ReleaseFlags, ReleaseState } from './release-flags'
export { releaseFlags } from './release-flags'

function stateFromDiff(diff: ApprovedReleaseDiff): ReleaseState {
  const pending = [
    ...diff.adds,
    ...diff.updates,
    ...diff.removals,
    ...diff.scheduledUpcoming,
  ]
  return {
    live: diff.livePublication !== null,
    liveIds: new Set(diff.livePublication?.entryIds ?? []),
    pendingIds: new Set(pending.map((item) => item.id)),
  }
}

/**
 * Which entries are live and which have approved changes waiting for the next
 * go live, per site. Development environments get `NO_RELEASE_STATE`; sites
 * that do not exist are absent. The diffs come from the release diff cache.
 */
export async function loadReleaseStates(
  siteIds: string[],
): Promise<Map<string, ReleaseState>> {
  const rows =
    siteIds.length === 0
      ? []
      : await db
          .select({ id: site.id, environment: site.environment })
          .from(site)
          .where(inArray(site.id, siteIds))
  const out = new Map<string, ReleaseState>()
  const production: string[] = []
  for (const row of rows) {
    if (isDevSite(row)) out.set(row.id, NO_RELEASE_STATE)
    else production.push(row.id)
  }
  for (const [siteId, diff] of await approvedReleaseDiffs(production)) {
    out.set(siteId, stateFromDiff(diff))
  }
  return out
}

/**
 * The release state of one site. Call it once per tool call and apply the
 * result to every entry that call returns. `liveSnapshot` also loads the live
 * publication's snapshot, for tools that show the live version.
 */
export async function loadReleaseState(
  siteId: string,
  options: { liveSnapshot?: boolean } = {},
): Promise<ReleaseState> {
  const [state, live] = await Promise.all([
    loadReleaseStates([siteId]),
    options.liveSnapshot ? getLivePublication(siteId) : null,
  ])
  const found = state.get(siteId)
  if (!found) throw new NotFoundError(m.server_site_not_found())
  if (found === NO_RELEASE_STATE || !options.liveSnapshot) return found
  return { ...found, liveSnapshot: live?.snapshot ?? null }
}
