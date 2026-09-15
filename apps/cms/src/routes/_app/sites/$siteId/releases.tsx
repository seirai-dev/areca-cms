import { useState } from 'react'
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import {
  Copy,
  Hammer,
  History,
  RotateCcw,
  ScrollText,
  XCircle,
} from 'lucide-react'
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
import { ListPagination } from '#/components/list-pagination'
import { PageHeader } from '#/components/page-header'
import { QueryError } from '#/components/query-error'
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
  wasLive: boolean
  snapshotHash: string
  requestedBy: string | null
  requestedByName: string | null
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

const PUBLICATIONS_PAGE_SIZE = 20
const EMPTY_PUBLICATIONS: PublicationRow[] = []
const EMPTY_JOBS: JobRow[] = []

function isActiveJob(status: BuildJobStatus) {
  return ACTIVE_JOB_STATUSES.includes(
    status as (typeof ACTIVE_JOB_STATUSES)[number],
  )
}

function canRollback(row: PublicationRow) {
  return row.wasLive && row.status !== 'live'
}

function ReleasesPage() {
  const { siteId } = Route.useParams()
  const queryClient = useQueryClient()
  const [publicationsOffset, setPublicationsOffset] = useState(0)
  const [rollbackTarget, setRollbackTarget] = useState<PublicationRow | null>(
    null,
  )
  const [cancelTarget, setCancelTarget] = useState<JobRow | null>(null)
  const [logsJobId, setLogsJobId] = useState<string | null>(null)

  const publicationsQuery = useQuery({
    queryKey: [...queryKeys.publications(siteId), publicationsOffset],
    queryFn: () =>
      listPublicationsFn({
        data: {
          siteId,
          limit: PUBLICATIONS_PAGE_SIZE + 1,
          offset: publicationsOffset,
        },
      }),
    placeholderData: keepPreviousData,
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
      const busy = items?.some((item) => isActiveJob(item.status))
      return busy ? 2000 : false
    },
  })

  const logsQuery = useQuery({
    queryKey: queryKeys.buildJob(logsJobId ?? ''),
    queryFn: () => getBuildJobFn({ data: { id: logsJobId ?? '' } }),
    enabled: Boolean(logsJobId),
    refetchInterval: (query) => {
      const status = (query.state.data as JobRow | undefined)?.status
      return status && isActiveJob(status) ? 3000 : false
    },
  })

  async function invalidate() {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: queryKeys.publications(siteId),
      }),
      queryClient.invalidateQueries({ queryKey: queryKeys.buildJobs(siteId) }),
      queryClient.invalidateQueries({
        queryKey: queryKeys.releaseStatus(siteId),
      }),
    ])
  }

  const rollbackMutation = useMutation({
    mutationFn: (publicationId: string) =>
      requestRollbackFn({ data: { siteId, publicationId } }),
    onSuccess: async () => {
      toast.success('Rollback requested')
      setPublicationsOffset(0)
      await invalidate()
    },
    onError: (error) => toast.error(errorMessage(error, 'Could not roll back')),
  })

  const cancelMutation = useMutation({
    mutationFn: (id: string) => cancelJobFn({ data: { id } }),
    onSuccess: async () => {
      toast.success('Job cancelled')
      await invalidate()
    },
    onError: (error) =>
      toast.error(errorMessage(error, 'Could not cancel job')),
  })

  const pubHelper = createDataColumns<PublicationRow>()
  const publicationColumns = pubHelper.columns([
    pubHelper.accessor('createdAt', {
      header: 'Created',
      sortFn: 'datetime',
      cell: ({ row }) => (
        <span className="whitespace-nowrap">
          {formatDateTime(row.original.createdAt)}
        </span>
      ),
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
      header: 'Snapshot',
      cell: ({ row }) => (
        <span className="font-mono text-xs" title={row.original.snapshotHash}>
          {shortId(row.original.snapshotHash)}
        </span>
      ),
    }),
    pubHelper.accessor('requestedByName', {
      header: 'Requested by',
      cell: ({ row }) => row.original.requestedByName ?? 'System',
    }),
    pubHelper.accessor('deployedAt', {
      header: 'Deployed',
      sortFn: 'datetime',
      cell: ({ row }) => (
        <span className="whitespace-nowrap text-muted-foreground">
          {formatDateTime(row.original.deployedAt)}
        </span>
      ),
    }),
    pubHelper.display({
      id: 'actions',
      header: () => <span className="sr-only">Actions</span>,
      enableSorting: false,
      cell: ({ row }) => (
        <div className="flex justify-end">
          {canRollback(row.original) ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              data-testid="rollback-publication"
              disabled={rollbackMutation.isPending}
              onClick={() => setRollbackTarget(row.original)}
            >
              <RotateCcw />
              Rollback
            </Button>
          ) : null}
        </div>
      ),
    }),
  ])

  const jobHelper = createDataColumns<JobRow>()
  const jobColumns = jobHelper.columns([
    jobHelper.accessor('createdAt', {
      header: 'Created',
      sortFn: 'datetime',
      cell: ({ row }) => (
        <span className="whitespace-nowrap">
          {formatDateTime(row.original.createdAt)}
        </span>
      ),
    }),
    jobHelper.accessor('status', {
      header: 'Status',
      cell: ({ row }) => (
        <div className="grid gap-1">
          <div>
            <JobStatusBadge status={row.original.status} />
          </div>
          {row.original.status === 'failed' && row.original.error ? (
            <p
              className="max-w-xs truncate text-xs text-destructive"
              title={row.original.error}
            >
              {row.original.error}
            </p>
          ) : null}
        </div>
      ),
    }),
    jobHelper.accessor('attempts', { header: 'Attempts' }),
    jobHelper.display({
      id: 'actions',
      header: () => <span className="sr-only">Actions</span>,
      enableSorting: false,
      cell: ({ row }) => (
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setLogsJobId(row.original.id)}
          >
            <ScrollText />
            Logs
          </Button>
          {row.original.status === 'queued' ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="text-destructive hover:text-destructive"
              disabled={cancelMutation.isPending}
              onClick={() => setCancelTarget(row.original)}
            >
              <XCircle />
              Cancel
            </Button>
          ) : null}
        </div>
      ),
    }),
  ])

  const publicationRows: PublicationRow[] =
    publicationsQuery.data ?? EMPTY_PUBLICATIONS
  const publicationsHasMore = publicationRows.length > PUBLICATIONS_PAGE_SIZE
  const publications = publicationsHasMore
    ? publicationRows.slice(0, PUBLICATIONS_PAGE_SIZE)
    : publicationRows
  const jobs: JobRow[] = jobsQuery.data ?? EMPTY_JOBS
  const logsJob = logsQuery.data as JobRow | undefined
  const logsText = logsJob?.logs || logsJob?.error || ''

  async function copyLogs() {
    if (!logsText) return
    try {
      await navigator.clipboard.writeText(logsText)
      toast.success('Logs copied to clipboard')
    } catch {
      toast.error('Could not copy logs')
    }
  }

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Releases"
        description="Every publication of this site and the build jobs that deploy them."
      />

      <section className="grid gap-3">
        <div>
          <h2 className="text-lg font-medium">Publications</h2>
          <p className="text-sm text-muted-foreground">
            Snapshots of the site content. Roll back to any previously live
            publication.
          </p>
        </div>
        {publicationsQuery.isError ? (
          <QueryError
            title="Could not load publications"
            error={publicationsQuery.error}
            onRetry={() => publicationsQuery.refetch()}
            retrying={publicationsQuery.isFetching}
          />
        ) : publicationsQuery.isLoading ? (
          <Skeleton className="h-48 w-full" />
        ) : publications.length === 0 ? (
          <EmptyState
            icon={<History />}
            title="No publications yet"
            description="Publish the site to create the first release."
          />
        ) : (
          <>
            <DataTable
              columns={publicationColumns}
              data={publications}
              caption="Publications"
            />
            <ListPagination
              offset={publicationsOffset}
              limit={PUBLICATIONS_PAGE_SIZE}
              count={publications.length}
              hasMore={publicationsHasMore}
              onChange={setPublicationsOffset}
              isFetching={publicationsQuery.isFetching}
              noun="publications"
            />
          </>
        )}
      </section>

      <section className="grid gap-3">
        <div>
          <h2 className="text-lg font-medium">Build jobs</h2>
          <p className="text-sm text-muted-foreground">
            Queued jobs can be cancelled before they start building.
          </p>
        </div>
        {jobsQuery.isError ? (
          <QueryError
            title="Could not load build jobs"
            error={jobsQuery.error}
            onRetry={() => jobsQuery.refetch()}
            retrying={jobsQuery.isFetching}
          />
        ) : jobsQuery.isLoading ? (
          <Skeleton className="h-48 w-full" />
        ) : jobs.length === 0 ? (
          <EmptyState
            icon={<Hammer />}
            title="No build jobs yet"
            description="Jobs appear here once the site is published."
          />
        ) : (
          <DataTable columns={jobColumns} data={jobs} caption="Build jobs" />
        )}
      </section>

      <ConfirmDialog
        open={rollbackTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRollbackTarget(null)
        }}
        title="Roll back to this publication?"
        description={
          rollbackTarget
            ? `The snapshot from ${formatDateTime(rollbackTarget.createdAt)} will be redeployed and replace the current live release. Content published since then will no longer be live until you publish again.`
            : undefined
        }
        confirmLabel="Rollback"
        variant="destructive"
        onConfirm={async () => {
          if (rollbackTarget)
            await rollbackMutation.mutateAsync(rollbackTarget.id)
        }}
      />

      <ConfirmDialog
        open={cancelTarget !== null}
        onOpenChange={(open) => {
          if (!open) setCancelTarget(null)
        }}
        title="Cancel this build job?"
        description="The job will be removed from the queue and the site will not be deployed. You can publish again to start a new build."
        confirmLabel="Cancel job"
        cancelLabel="Keep job"
        variant="destructive"
        onConfirm={async () => {
          if (cancelTarget) await cancelMutation.mutateAsync(cancelTarget.id)
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
            <DialogDescription asChild>
              <div className="flex flex-wrap items-center gap-2">
                {logsJob ? (
                  <>
                    <JobStatusBadge status={logsJob.status} />
                    <span>
                      Started {formatDateTime(logsJob.createdAt)} ·{' '}
                      {logsJob.attempts}{' '}
                      {logsJob.attempts === 1 ? 'attempt' : 'attempts'}
                    </span>
                  </>
                ) : (
                  'Loading…'
                )}
              </div>
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="h-80 rounded-md border bg-muted/40 p-3">
            <pre className="font-mono text-xs whitespace-pre-wrap break-all">
              {logsQuery.isError
                ? errorMessage(logsQuery.error, 'Could not load logs')
                : logsQuery.isLoading
                  ? 'Loading…'
                  : logsText || 'No logs yet.'}
            </pre>
          </ScrollArea>
          <div className="flex justify-end">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!logsText}
              onClick={copyLogs}
            >
              <Copy />
              Copy logs
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
