import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { useState } from 'react'

import { Alert, AlertDescription } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import { Checkbox } from '#/components/ui/checkbox'
import { Label } from '#/components/ui/label'
import type { BuildJobStatus } from '#/lib/types'
import {
  getSiteReleaseStatusFn,
  listBuildJobsFn,
  requestPublicationFn,
} from '#/server/fn/publishing'

import { queryKeys } from './query-keys'
import { ACTIVE_JOB_STATUSES, errorMessage, formatDateTime, shortId } from './utils'

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
      if (result && 'ok' in result && result.ok === false) {
        setPublishErrors(result.errors)
        return
      }
      setPublishErrors([])
      toast.success('Publish requested')
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.releaseStatus(siteId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.publications(siteId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.buildJobs(siteId) }),
      ])
    },
    onError: (error) => toast.error(errorMessage(error, 'Could not publish site')),
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
    <div className="grid gap-3 rounded-lg border p-4" data-testid="release-status">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1 text-sm">
          {statusQuery.isLoading ? (
            <p className="text-muted-foreground">Loading release status…</p>
          ) : status?.live ? (
            <p data-testid="release-live">
              Live publication {shortId(status.live.id)} ·{' '}
              {formatDateTime(status.live.deployedAt ?? status.live.createdAt)}
            </p>
          ) : (
            <p>No live publication yet.</p>
          )}
          {status?.activeJob ? (
            <p className="flex items-center gap-2" data-testid="active-job">
              {jobActive ? <Loader2 className="size-4 animate-spin" /> : null}
              Job {status.activeJob.status}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Checkbox
              id="urgent"
              checked={urgent}
              onCheckedChange={(checked) => setUrgent(checked === true)}
            />
            <Label htmlFor="urgent">Urgent</Label>
          </div>
          <Button
            type="button"
            data-testid="publish-site"
            disabled={publishMutation.isPending}
            onClick={() => publishMutation.mutate()}
          >
            {publishMutation.isPending ? 'Publishing…' : 'Publish site'}
          </Button>
        </div>
      </div>
      <p className="text-sm text-muted-foreground">
        Publishing builds and deploys all published entries.
      </p>
      {publishErrors.length > 0 ? (
        <Alert variant="destructive">
          <AlertDescription>
            <ul className="list-disc pl-4">
              {publishErrors.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}
      {lastFailure ? (
        <Alert variant="destructive">
          <AlertDescription>
            Last failure: {lastFailure.error ?? 'Build failed'}
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  )
}
