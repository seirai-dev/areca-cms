import type { Snapshot } from '#/lib/types'

/**
 * Pure helpers for the live and pending flags an agent reads on each entry.
 * Kept free of database imports so they can be unit tested directly.
 */

export type ReleaseState = {
  liveSnapshot?: Snapshot | null
  liveIds: ReadonlySet<string>
  pendingIds: ReadonlySet<string>
}

export type ReleaseFlags = {
  /** The entry is on the live site right now (its live version may be older than the draft). */
  live: boolean
  /** The entry has approved changes, an approval, a schedule or a withdrawal that no go live has published yet. */
  pendingRelease: boolean
}

/**
 * A development environment has no releases (docs/design/dev-environments.md,
 * Decision 7): nothing is live and nothing is pending, so every entry reads
 * `live: false, pendingRelease: false` and keeps its `ready` status.
 */
export const NO_RELEASE_STATE: ReleaseState = {
  liveSnapshot: null,
  liveIds: new Set(),
  pendingIds: new Set(),
}

export function releaseFlags(
  state: ReleaseState,
  entryId: string,
): ReleaseFlags {
  return {
    live: state.liveIds.has(entryId),
    pendingRelease: state.pendingIds.has(entryId),
  }
}
