import { useQuery } from '@tanstack/react-query'

import { isActiveJobStatus } from '#/lib/status'
import type { BuildJobStatus } from '#/lib/types'

import type { LiveMembership } from './entry-live-state'
import { latestJobsQuery, releaseStatusQuery } from './queries'
import type { JobRow, ReleaseStatusData } from './queries'

/**
 * The site's publishing state, as the tray, the panel, the workspace card
 * and the overview see it (brief §3.6):
 *
 * - `loading`     status not known yet
 * - `going-live`  a build job is queued or running (`step` says which)
 * - `failed`      the newest build job failed
 * - `never-live`  nothing has ever gone live
 * - `ready`       approved snapshot differs from live (adds, updates, removals)
 * - `up-to-date`  live matches the approved candidate
 */
export type GoLiveState =
  'loading' | 'going-live' | 'failed' | 'never-live' | 'ready' | 'up-to-date'

export type ReleaseStatus = {
  state: GoLiveState
  data: ReleaseStatusData | undefined
  live: ReleaseStatusData['live']
  /** Approved snapshot changes that are not live yet (adds + updates + removals). */
  pending: number
  /** The running step while going live. */
  step: BuildJobStatus | null
  /** When the live release went live. */
  liveSince: Date | null
  lastFailure: JobRow | null
  isError: boolean
  error: unknown
  refetch: () => void
  /** Live/demo snapshot membership for Ready vs Live. Undefined while loading. */
  liveMembership: LiveMembership
}

export function useReleaseStatus(siteId: string | undefined): ReleaseStatus {
  const statusQuery = useQuery({
    ...releaseStatusQuery(siteId ?? ''),
    enabled: Boolean(siteId),
  })
  const data = statusQuery.data
  const active = Boolean(
    data?.activeJob && isActiveJobStatus(data.activeJob.status),
  )
  const jobsQuery = useQuery({
    ...latestJobsQuery(siteId ?? '', active),
    enabled: Boolean(siteId),
  })

  const latest = jobsQuery.data?.find((job) => job.status !== 'cancelled')
  const lastFailure = latest?.status === 'failed' ? latest : null
  const pending = data?.pendingEntries ?? 0
  const liveAt = data?.live
    ? (data.live.deployedAt ?? data.live.createdAt)
    : null

  const hasBaseline = Boolean(
    data?.live || (data?.publishingMode === 'demo' && data.demo),
  )
  const liveMembership: LiveMembership = !data
    ? undefined
    : hasBaseline
      ? {
          liveEntryIds: data.liveEntryIds,
          liveSlugsByEntryId: data.liveSlugsByEntryId,
          pendingEntryIds: data.pendingEntryIds,
        }
      : null

  let state: GoLiveState
  if (!data) state = 'loading'
  else if (active) state = 'going-live'
  else if (lastFailure) state = 'failed'
  else if (!data.live) state = 'never-live'
  else if (pending > 0) state = 'ready'
  else state = 'up-to-date'

  return {
    state,
    data,
    live: data?.live ?? null,
    pending,
    step: active ? (data?.activeJob?.status ?? null) : null,
    liveSince: liveAt ? new Date(liveAt) : null,
    lastFailure,
    isError: statusQuery.isError,
    error: statusQuery.error,
    refetch: () => void statusQuery.refetch(),
    liveMembership,
  }
}
