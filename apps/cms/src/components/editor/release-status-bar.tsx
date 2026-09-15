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
import {
  getSiteReleaseStatusFn,
  listBuildJobsFn,
  requestPublicationFn,
} from '#/server/fn/publishing'

import { queryKeys } from './query-keys'
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

const JOB_LABEL: Record<BuildJobStatus, string> = {
  queued: 'Queued',
  building: 'Building',
  validating: 'Validating',
  deploying: 'Deploying',
  succeeded: 'Succeeded',
  failed: 'Failed',
  cancelled: 'Cancelled',
}

/**
 * Site-level publish control. Publishing builds a snapshot of every published
 * entry and (when a deployment target is configured) deploys it.
 */
export function ReleaseStatusBar({ siteId }: { siteId: string }) {
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
      toast.success('Publish requested', {
        description:
          'The release is being built. This page updates automatically.',
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
      toast.error(errorMessage(error, 'Could not publish site')),
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
      aria-label="Site release status"
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
              <p className="text-muted-foreground">Loading release status…</p>
            ) : statusQuery.isError ? (
              <p className="text-destructive">Could not load release status.</p>
            ) : status?.live ? (
              <p data-testid="release-live" className="font-medium">
                Live since{' '}
                {formatDateTime(
                  status.live.deployedAt ?? status.live.createdAt,
                )}
                <span className="ml-2 font-mono text-xs font-normal text-muted-foreground">
                  {shortId(status.live.id)}
                </span>
              </p>
            ) : (
              <p className="font-medium">Nothing published yet</p>
            )}
            {status?.activeJob ? (
              <p
                className="flex items-center gap-2 text-muted-foreground"
                data-testid="active-job"
              >
                {jobActive
                  ? `Release in progress: ${JOB_LABEL[status.activeJob.status].toLowerCase()}…`
                  : `Last job: ${JOB_LABEL[status.activeJob.status]}`}
              </p>
            ) : (
              <p className="text-muted-foreground">
                Publishing builds a snapshot of all published entries and
                releases it to the live site.
              </p>
            )}
          </div>
        </div>
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
                  Urgent
                </Label>
              </div>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              Jump the build queue ahead of other sites.
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
            {publishMutation.isPending ? 'Publishing…' : 'Publish site'}
          </Button>
        </div>
      </div>
      {publishErrors.length > 0 ? (
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>Fix these before publishing</AlertTitle>
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
          <AlertTitle>The last release failed</AlertTitle>
          <AlertDescription>
            <p>{lastFailure.error ?? 'Build failed'}</p>
            <Link
              to="/sites/$siteId/releases"
              params={{ siteId }}
              className="mt-1 text-sm underline"
            >
              View build logs
            </Link>
          </AlertDescription>
        </Alert>
      ) : null}
    </section>
  )
}
