import { queryOptions } from '@tanstack/react-query'

import { queryKeys } from '#/lib/query-keys'
import { isActiveJobStatus } from '#/lib/status'
import {
  getBuildJobFn,
  getSiteReleaseStatusFn,
  listBuildJobsFn,
  listPublicationsFn,
} from '#/server/fn/publishing'

/**
 * Query options for everything Go‑live reads. Polling (brief §3.6): status
 * every 5s while a job is active, lists every 2s while busy, logs every 3s
 * while the job runs. Nothing polls while idle.
 */

export type ReleaseStatusData = Awaited<
  ReturnType<typeof getSiteReleaseStatusFn>
>

/** A build job as the lists show it; `getBuildJobFn` adds the logs. */
export type JobRow = Awaited<ReturnType<typeof listBuildJobsFn>>[number]

export type PublicationRow = Awaited<
  ReturnType<typeof listPublicationsFn>
>[number]

export type PublicationOrigin = PublicationRow['origin']

export function releaseStatusQuery(siteId: string) {
  return queryOptions({
    queryKey: queryKeys.releaseStatus(siteId),
    queryFn: () => getSiteReleaseStatusFn({ data: { siteId } }),
    refetchInterval: (query) => (query.state.data?.activeJob ? 5000 : false),
    staleTime: 10_000,
  })
}

/**
 * The newest few build jobs; enough to tell whether the last release failed.
 * Shares the `build-jobs` prefix so every Go‑live invalidation reaches it.
 */
export function latestJobsQuery(siteId: string, active = false) {
  return queryOptions({
    queryKey: [...queryKeys.buildJobs(siteId), 'latest'] as const,
    queryFn: () => listBuildJobsFn({ data: { siteId, limit: 5 } }),
    refetchInterval: active ? 5000 : false,
    staleTime: 30_000,
  })
}

export function jobsQuery(siteId: string) {
  return queryOptions({
    queryKey: [...queryKeys.buildJobs(siteId), 'all'] as const,
    queryFn: () => listBuildJobsFn({ data: { siteId, limit: 50 } }),
    refetchInterval: (query) =>
      query.state.data?.some((job) => isActiveJobStatus(job.status))
        ? 2000
        : false,
  })
}

export const PUBLICATIONS_PAGE_SIZE = 10

export function publicationsQuery(siteId: string, pages: number) {
  const limit = PUBLICATIONS_PAGE_SIZE * pages
  return queryOptions({
    queryKey: [...queryKeys.publications(siteId), limit] as const,
    // One extra row tells us whether there is more.
    queryFn: () =>
      listPublicationsFn({
        data: { siteId, limit: Math.min(limit + 1, 100), offset: 0 },
      }),
    refetchInterval: (query) =>
      query.state.data?.some(
        (row) => row.status === 'pending' || row.status === 'building',
      )
        ? 2000
        : false,
  })
}

export function buildJobQuery(jobId: string) {
  return queryOptions({
    queryKey: queryKeys.buildJob(jobId),
    queryFn: () => getBuildJobFn({ data: { id: jobId } }),
    enabled: Boolean(jobId),
    refetchInterval: (query) => {
      const status = query.state.data?.status
      return status && isActiveJobStatus(status) ? 3000 : false
    },
  })
}
