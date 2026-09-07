import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { toast } from 'sonner'

import { ConfirmDialog } from '#/components/confirm-dialog'
import { queryKeys } from '#/components/editor/query-keys'
import {
  JobStatusBadge,
  PublicationStatusBadge,
} from '#/components/editor/status-badge'
import {
  ACTIVE_JOB_STATUSES,
  errorMessage,
  formatDateTime,
  shortId,
} from '#/components/editor/utils'
import { EmptyState } from '#/components/empty-state'
import { PageHeader } from '#/components/page-header'
import { createDataColumns, DataTable } from '#/components/data-table'
import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'
import { ScrollArea } from '#/components/ui/scroll-area'
import { Skeleton } from '#/components/ui/skeleton'
import type { BuildJobStatus, PublicationStatus } from '#/lib/types'
import {
  cancelJobFn,
  getBuildJobFn,
  listBuildJobsFn,
  listPublicationsFn,
  requestRollbackFn,
} from '#/server/fn/publishing'

export const Route = createFileRoute('/_app/sites/$siteId/releases')({
  component: ReleasesPage,
})

type PublicationRow = {
  id: string
  status: PublicationStatus
  snapshotHash: string
  requestedBy: string | null
  createdAt: string | Date
  deployedAt: string | Date | null
}

type JobRow = {
  id: string
  status: BuildJobStatus
  attempts: number
  createdAt: string | Date
  error: string | null
  logs: string | null
}

const EMPTY_PUBLICATIONS: PublicationRow[] = []
const EMPTY_JOBS: JobRow[] = []

function canRollback(status: PublicationStatus) {
  return status === 'superseded' || status === 'rolled_back'
}

function ReleasesPage() {
  const { siteId } = Route.useParams()
  const queryClient = useQueryClient()
  const [rollbackId, setRollbackId] = useState<string | null>(null)
  const [logsJobId, setLogsJobId] = useState<string | null>(null)

  const publicationsQuery = useQuery({
    queryKey: queryKeys.publications(siteId),
    queryFn: () => listPublicationsFn({ data: { siteId, limit: 50, offset: 0 } }),
    refetchInterval: (query) => {
      const items = query.state.data as PublicationRow[] | undefined
      const busy = items?.some(
        (item) => item.status === 'pending' || item.status === 'building',
      )
      return busy ? 2000 : false
    },
  })

  const jobsQuery = useQuery({
    queryKey: queryKeys.buildJobs(siteId),
    queryFn: () => listBuildJobsFn({ data: { siteId, limit: 50 } }),
    refetchInterval: (query) => {
      const items = query.state.data as JobRow[] | undefined
      const busy = items?.some((item) =>
        ACTIVE_JOB_STATUSES.includes(
          item.status as (typeof ACTIVE_JOB_STATUSES)[number],
        ),
      )
      return busy ? 2000 : false
    },
  })

  const logsQuery = useQuery({
    queryKey: queryKeys.buildJob(logsJobId ?? ''),
    queryFn: () => getBuildJobFn({ data: { id: logsJobId! } }),
    enabled: Boolean(logsJobId),
    refetchInterval: (query) => {
      const status = (query.state.data as JobRow | undefined)?.status
      return status &&
        ACTIVE_JOB_STATUSES.includes(status as (typeof ACTIVE_JOB_STATUSES)[number])
        ? 3000
        : false
    },
  })

  async function invalidate() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.publications(siteId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.buildJobs(siteId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.releaseStatus(siteId) }),
    ])
  }

  const rollbackMutation = useMutation({
    mutationFn: (publicationId: string) =>
      requestRollbackFn({ data: { siteId, publicationId } }),
    onSuccess: async () => {
      toast.success('Rollback requested')
      await invalidate()
    },
    onError: (error) => toast.error(errorMessage(error, 'Could not rollback')),
  })

  const cancelMutation = useMutation({
    mutationFn: (id: string) => cancelJobFn({ data: { id } }),
    onSuccess: async () => {
      toast.success('Job cancelled')
      await invalidate()
    },
    onError: (error) => toast.error(errorMessage(error, 'Could not cancel')),
  })

  const pubHelper = createDataColumns<PublicationRow>()
  const publicationColumns = pubHelper.columns([
    pubHelper.accessor('createdAt', {
      header: 'Created',
      cell: ({ row }) => formatDateTime(row.original.createdAt),
    }),
    pubHelper.accessor('status', {
      header: 'Status',
      cell: ({ row }) => (
        <PublicationStatusBadge
          status={row.original.status}
          testId={`publication-status-${row.original.status}`}
        />
      ),
    }),
    pubHelper.accessor('snapshotHash', {
      header: 'Hash',
      cell: ({ row }) => shortId(row.original.snapshotHash),
    }),
    pubHelper.accessor('requestedBy', {
      header: 'Requested by',
      cell: ({ row }) => shortId(row.original.requestedBy ?? '—', 12),
    }),
    pubHelper.accessor('deployedAt', {
      header: 'Deployed',
      cell: ({ row }) => formatDateTime(row.original.deployedAt),
    }),
    pubHelper.display({
      id: 'actions',
      header: '',
      cell: ({ row }) =>
        canRollback(row.original.status) ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            data-testid="rollback-publication"
            onClick={() => setRollbackId(row.original.id)}
          >
            Rollback
          </Button>
        ) : null,
    }),
  ])

  const jobHelper = createDataColumns<JobRow>()
  const jobColumns = jobHelper.columns([
    jobHelper.accessor('createdAt', {
      header: 'Created',
      cell: ({ row }) => formatDateTime(row.original.createdAt),
    }),
    jobHelper.accessor('status', {
      header: 'Status',
      cell: ({ row }) => <JobStatusBadge status={row.original.status} />,
    }),
    jobHelper.accessor('attempts', { header: 'Attempts' }),
    jobHelper.display({
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setLogsJobId(row.original.id)}
          >
            Logs
          </Button>
          {row.original.status === 'queued' ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => cancelMutation.mutate(row.original.id)}
            >
              Cancel
            </Button>
          ) : null}
        </div>
      ),
    }),
  ])

  const publications = (publicationsQuery.data ?? EMPTY_PUBLICATIONS) as PublicationRow[]
  const jobs = (jobsQuery.data ?? EMPTY_JOBS) as JobRow[]
  const logsJob = logsQuery.data as JobRow | undefined

  return (
    <div className="grid gap-8">
      <PageHeader title="Releases" description="Publications and build jobs" />

      <section className="grid gap-3">
        <h2 className="text-lg font-medium">Publications</h2>
        {publicationsQuery.isLoading ? (
          <Skeleton className="h-48 w-full" />
        ) : publications.length === 0 ? (
          <EmptyState
            title="No publications"
            description="Publish the site to create the first release."
          />
        ) : (
          <DataTable columns={publicationColumns} data={publications} />
        )}
      </section>

      <section className="grid gap-3">
        <h2 className="text-lg font-medium">Build jobs</h2>
        {jobsQuery.isLoading ? (
          <Skeleton className="h-48 w-full" />
        ) : jobs.length === 0 ? (
          <EmptyState title="No build jobs" />
        ) : (
          <DataTable columns={jobColumns} data={jobs} />
        )}
      </section>

      <ConfirmDialog
        open={rollbackId !== null}
        onOpenChange={(open) => {
          if (!open) setRollbackId(null)
        }}
        title="Rollback to this publication?"
        description="A new build job will redeploy this snapshot."
        confirmLabel="Rollback"
        onConfirm={async () => {
          if (rollbackId) await rollbackMutation.mutateAsync(rollbackId)
        }}
      />

      <Dialog
        open={logsJobId !== null}
        onOpenChange={(open) => {
          if (!open) setLogsJobId(null)
        }}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Build logs</DialogTitle>
            <DialogDescription>
              {logsJob ? <JobStatusBadge status={logsJob.status} /> : 'Loading…'}
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="h-80 rounded-md border bg-muted/40 p-3">
            <pre className="font-mono text-xs whitespace-pre-wrap">
              {logsQuery.isLoading
                ? 'Loading…'
                : logsJob?.logs || logsJob?.error || 'No logs yet.'}
            </pre>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  )
}
