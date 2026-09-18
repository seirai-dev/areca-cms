import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { toast } from 'sonner'
import { useState } from 'react'

import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import { Badge } from '#/components/ui/badge'
import { Surface } from '#/components/ui/card'
import { Spinner } from '#/components/ui/spinner'
import { Button } from '#/components/ui/button'
import { Checkbox } from '#/components/ui/checkbox'
import { Label } from '#/components/ui/label'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '#/components/ui/tooltip'
import type { BuildJobStatus } from '#/lib/types'
import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'
import {
  getSiteReleaseStatusFn,
  listBuildJobsFn,
  requestPublicationFn,
} from '#/server/fn/publishing'

import { queryKeys } from './query-keys'
import { jobStatusLabel } from './status-badge'
import {
  ACTIVE_JOB_STATUSES,
  errorMessage,
  formatDateTime,
  shortId,
} from './utils'
import {
  Warning,
  CheckCircle,
  CircleDashed,
  CircleNotch,
  Rocket,
} from '@phosphor-icons/react'

type ReleaseStatus = {
  live: {
    id: string
    createdAt: string | Date
    deployedAt: string | Date | null
  } | null
  activeJob: {
    id: string
    status: BuildJobStatus
    error: string | null
  } | null
  pendingEntries: number
}

type BuildJob = {
  id: string
  status: BuildJobStatus
  error: string | null
  finishedAt: string | Date | null
}

function releaseInProgressLabel(status: BuildJobStatus) {
  switch (status) {
    case 'queued':
      return m.editor_release_in_progress_queued()
    case 'building':
      return m.editor_release_in_progress_building()
    case 'validating':
      return m.editor_release_in_progress_validating()
    case 'deploying':
      return m.editor_release_in_progress_deploying()
    default:
      return m.editor_last_job({ status: jobStatusLabel(status) })
  }
}

function useReleaseStatus(siteId: string) {
  return useQuery({
    queryKey: queryKeys.releaseStatus(siteId),
    queryFn: () => getSiteReleaseStatusFn({ data: { siteId } }),
    refetchInterval: (query) => {
      const data = query.state.data as ReleaseStatus | undefined
      return data?.activeJob ? 5000 : false
    },
  })
}

/**
 * Live state of a site for the identity strip: when the site has a live
 * release, the time it went live. `null` while the status is loading.
 */
export function useSiteLiveState(siteId: string) {
  const statusQuery = useReleaseStatus(siteId)
  const status = statusQuery.data as ReleaseStatus | undefined
  if (!status?.live) return null
  const liveSince = status.live.deployedAt ?? status.live.createdAt
  return { liveSince: liveSince ? new Date(liveSince) : null }
}

/** Compact live/pending pill for the site header. */
export function SiteLiveBadge({ siteId }: { siteId: string }) {
  const statusQuery = useReleaseStatus(siteId)
  const status = statusQuery.data as ReleaseStatus | undefined
  if (!status) return null
  if (status.activeJob) {
    return (
      <Badge variant="warning">
        <CircleNotch className="animate-spin" />
        {m.editor_publishing()}
      </Badge>
    )
  }
  if (!status.live) {
    return <Badge variant="muted">{m.editor_not_live()}</Badge>
  }
  if (status.pendingEntries > 0) {
    return (
      <Badge variant="warning">
        {m.editor_pending_changes_badge({ count: status.pendingEntries })}
      </Badge>
    )
  }
  return (
    <Badge variant="success">
      <CheckCircle />
      {m.editor_publication_live()}
    </Badge>
  )
}

/**
 * Site-level publish control. Publishing an entry only marks it published;
 * this panel is where a snapshot of every published entry is built and
 * released to the live site. It makes that two-step model explicit by
 * counting the published entries the live snapshot does not include yet.
 */
export function ReleaseStatusBar({
  siteId,
  canPublish,
}: {
  siteId: string
  canPublish: boolean
}) {
  const queryClient = useQueryClient()
  const [urgent, setUrgent] = useState(false)
  const [publishErrors, setPublishErrors] = useState<string[]>([])

  const statusQuery = useReleaseStatus(siteId)

  const jobsQuery = useQuery({
    queryKey: queryKeys.buildJobs(siteId),
    queryFn: () => listBuildJobsFn({ data: { siteId, limit: 20 } }),
    refetchInterval: () => (statusQuery.data?.activeJob ? 5000 : false),
  })

  const publishMutation = useMutation({
    mutationFn: () =>
      requestPublicationFn({
        data: { siteId, priority: urgent ? 100 : undefined },
      }),
    onSuccess: async (result) => {
      if ('ok' in result && result.ok === false) {
        setPublishErrors(result.errors)
        return
      }
      setPublishErrors([])
      toast.success(m.editor_publish_requested(), {
        description: m.editor_publish_requested_description(),
      })
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: queryKeys.releaseStatus(siteId),
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.publications(siteId),
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.buildJobs(siteId),
        }),
      ])
    },
    onError: (error) =>
      toast.error(errorMessage(error, m.editor_could_not_publish_site())),
  })

  const status = statusQuery.data as ReleaseStatus | undefined
  const jobs = (jobsQuery.data ?? []) as BuildJob[]
  const lastFailure = jobs.find((job) => job.status === 'failed')
  const jobActive = Boolean(
    status?.activeJob &&
    ACTIVE_JOB_STATUSES.includes(
      status.activeJob.status as (typeof ACTIVE_JOB_STATUSES)[number],
    ),
  )
  const pending = status?.pendingEntries ?? 0
  const upToDate = Boolean(status?.live) && pending === 0 && !jobActive

  return (
    <Surface
      className="gap-3 px-4 py-3"
      data-testid="release-status"
      data-pending={pending}
      aria-label={m.editor_site_release_status()}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span
          className={cn(
            'flex size-7 shrink-0 items-center justify-center rounded-control',
            upToDate
              ? 'bg-status-success-bg text-icon-success'
              : pending > 0 || jobActive
                ? 'bg-status-warning-bg text-icon-warning'
                : 'bg-background-subtle text-icon-muted',
          )}
        >
          {jobActive ? (
            <CircleNotch className="size-4 animate-spin" />
          ) : upToDate ? (
            <CheckCircle className="size-4" />
          ) : pending > 0 ? (
            <CircleDashed className="size-4" />
          ) : (
            <Rocket className="size-4" />
          )}
        </span>
        {statusQuery.isLoading ? (
          <p className="text-ds-body-sm text-text-muted">
            {m.editor_loading_release_status()}
          </p>
        ) : statusQuery.isError ? (
          <p className="text-ds-body-sm text-text-error">
            {m.editor_could_not_load_release_status()}
          </p>
        ) : (
          <>
            <p className="min-w-0 truncate text-ds-label-md text-text-primary">
              {jobActive && status?.activeJob
                ? releaseInProgressLabel(status.activeJob.status)
                : pending > 0
                  ? pending === 1
                    ? m.editor_pending_changes_one({ count: pending })
                    : m.editor_pending_changes_other({ count: pending })
                  : status?.live
                    ? m.editor_live_site_up_to_date()
                    : m.editor_nothing_published_yet()}
            </p>
            {status?.live ? (
              <span
                className="min-w-0 truncate text-ds-body-xs text-text-muted"
                data-testid="release-live"
              >
                {m.editor_live_since({
                  datetime: formatDateTime(
                    status.live.deployedAt ?? status.live.createdAt,
                  ),
                })}
                <span className="ml-2 text-ds-mono-xs">
                  {shortId(status.live.id)}
                </span>
              </span>
            ) : (
              <span className="min-w-0 truncate text-ds-body-xs text-text-muted">
                {m.editor_publishing_builds_snapshot()}
              </span>
            )}
            {status?.activeJob && !jobActive ? (
              <span
                className="text-ds-body-xs text-text-muted"
                data-testid="active-job"
              >
                {m.editor_last_job({
                  status: jobStatusLabel(status.activeJob.status),
                })}
              </span>
            ) : null}
            {jobActive ? (
              <span className="sr-only" data-testid="active-job">
                {releaseInProgressLabel(status!.activeJob!.status)}
              </span>
            ) : null}
          </>
        )}
        {canPublish ? (
          <div className="ml-auto flex shrink-0 items-center gap-3">
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="urgent"
                    checked={urgent}
                    onCheckedChange={(checked) => setUrgent(checked === true)}
                  />
                  <Label htmlFor="urgent" className="cursor-pointer">
                    {m.editor_urgent()}
                  </Label>
                </div>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {m.editor_urgent_tooltip()}
              </TooltipContent>
            </Tooltip>
            <Button
              type="button"
              size="sm"
              data-testid="publish-site"
              disabled={publishMutation.isPending}
              onClick={() => publishMutation.mutate()}
            >
              {publishMutation.isPending ? <Spinner /> : <Rocket />}
              {publishMutation.isPending
                ? m.editor_publishing()
                : m.editor_publish_site()}
            </Button>
          </div>
        ) : null}
      </div>
      {publishErrors.length > 0 ? (
        <Alert variant="destructive">
          <Warning />
          <AlertTitle>{m.editor_fix_before_publishing()}</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-4">
              {publishErrors.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}
      {lastFailure && !jobActive ? (
        <Alert variant="destructive">
          <Warning />
          <AlertTitle>{m.editor_last_release_failed()}</AlertTitle>
          <AlertDescription>
            <p>{lastFailure.error ?? m.editor_build_failed()}</p>
            <Link
              to="/sites/$siteId/releases"
              params={{ siteId }}
              className="mt-1 text-sm underline"
            >
              {m.editor_view_build_logs()}
            </Link>
          </AlertDescription>
        </Alert>
      ) : null}
    </Surface>
  )
}
