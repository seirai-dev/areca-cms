import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { AlertTriangle, CheckCircle2, Loader2, Rocket } from 'lucide-react'
import { toast } from 'sonner'
import { useState } from 'react'

import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import { Checkbox } from '#/components/ui/checkbox'
import { Label } from '#/components/ui/label'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '#/components/ui/tooltip'
import type { BuildJobStatus } from '#/lib/types'
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

/**
 * Site-level publish control. Publishing builds a snapshot of every published
 * entry and (when a deployment target is configured) deploys it.
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

  const statusQuery = useQuery({
    queryKey: queryKeys.releaseStatus(siteId),
    queryFn: () => getSiteReleaseStatusFn({ data: { siteId } }),
    refetchInterval: (query) => {
      const data = query.state.data as ReleaseStatus | undefined
      return data?.activeJob ? 5000 : false
    },
  })

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

  return (
    <section
      className="grid gap-3 border-b pb-5"
      data-testid="release-status"
      aria-label={m.editor_site_release_status()}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-moss-900 text-fern-300 dark:bg-moss-200 dark:text-moss-900">
            {jobActive ? (
              <Loader2 className="size-4 animate-spin" />
            ) : status?.live ? (
              <CheckCircle2 className="size-4" />
            ) : (
              <Rocket className="size-4" />
            )}
          </div>
          <div className="min-w-0 space-y-0.5 text-sm">
            {statusQuery.isLoading ? (
              <p className="text-muted-foreground">
                {m.editor_loading_release_status()}
              </p>
            ) : statusQuery.isError ? (
              <p className="text-destructive">
                {m.editor_could_not_load_release_status()}
              </p>
            ) : status?.live ? (
              <p data-testid="release-live" className="font-medium">
                {m.editor_live_since({
                  datetime: formatDateTime(
                    status.live.deployedAt ?? status.live.createdAt,
                  ),
                })}
                <span className="ml-2 font-mono text-xs font-normal text-muted-foreground">
                  {shortId(status.live.id)}
                </span>
              </p>
            ) : (
              <p className="font-medium">{m.editor_nothing_published_yet()}</p>
            )}
            {status?.activeJob ? (
              <p
                className="flex items-center gap-2 text-muted-foreground"
                data-testid="active-job"
              >
                {jobActive
                  ? releaseInProgressLabel(status.activeJob.status)
                  : m.editor_last_job({
                      status: jobStatusLabel(status.activeJob.status),
                    })}
              </p>
            ) : (
              <p className="text-muted-foreground">
                {m.editor_publishing_builds_snapshot()}
              </p>
            )}
          </div>
        </div>
        {canPublish ? (
          <div className="flex flex-wrap items-center gap-3">
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
              data-testid="publish-site"
              disabled={publishMutation.isPending}
              onClick={() => publishMutation.mutate()}
            >
              {publishMutation.isPending ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Rocket />
              )}
              {publishMutation.isPending
                ? m.editor_publishing()
                : m.editor_publish_site()}
            </Button>
          </div>
        ) : null}
      </div>
      {publishErrors.length > 0 ? (
        <Alert variant="destructive">
          <AlertTriangle />
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
          <AlertTriangle />
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
    </section>
  )
}
