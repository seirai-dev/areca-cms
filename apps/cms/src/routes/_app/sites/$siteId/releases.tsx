import { useMemo, useState } from 'react'
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { toast } from 'sonner'

import { ConfirmDialog } from '#/components/ui/confirm-dialog'
import { queryKeys } from '#/components/editor/query-keys'
import { JobStatusBadge } from '#/components/editor/status-badge'
import {
  ACTIVE_JOB_STATUSES,
  errorMessage,
  formatDateTime,
} from '#/components/editor/utils'
import { EmptyState } from '#/components/ui/empty-state'
import { ListPagination } from '#/components/list-pagination'
import { PageHeader } from '#/components/ui/page-header'
import { QueryError } from '#/components/ui/query-error'
import { BuildJobList } from '#/components/releases/build-job-list'
import { PublicationTimelineRow } from '#/components/releases/publication-row'
import type { JobRow, PublicationRow } from '#/components/releases/types'
import { Timeline } from '#/components/ui/timeline'
import { Button } from '#/components/ui/button'
import { ScrollArea } from '#/components/ui/scroll-area'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '#/components/ui/sheet'
import { Skeleton } from '#/components/ui/skeleton'
import { Spinner } from '#/components/ui/spinner'
import type { BuildJobStatus } from '#/lib/types'
import { canManageSite } from '#/lib/site-nav'
import { m } from '#/paraglide/messages'
import {
  cancelJobFn,
  getBuildJobFn,
  listBuildJobsFn,
  listPublicationsFn,
  requestPublicationFn,
  requestRollbackFn,
} from '#/server/fn/publishing'
import { ClockCounterClockwise, Copy, Rocket } from '@phosphor-icons/react'

export const Route = createFileRoute('/_app/sites/$siteId/releases')({
  component: ReleasesPage,
})

const PUBLICATIONS_PAGE_SIZE = 20
const EMPTY_PUBLICATIONS: PublicationRow[] = []
const EMPTY_JOBS: JobRow[] = []

function isActiveJob(status: BuildJobStatus) {
  return ACTIVE_JOB_STATUSES.includes(
    status as (typeof ACTIVE_JOB_STATUSES)[number],
  )
}

/**
 * Release history as one vertical timeline: every publication is a node, the
 * live one is marked, and its build jobs live inside the node instead of in a
 * separate column. Rollback sits on the publication it applies to.
 */
function ReleasesPage() {
  const { siteId } = Route.useParams()
  const { site, me } = Route.useRouteContext()
  const canManage = canManageSite(me, site.organizationId)
  const queryClient = useQueryClient()
  const [publicationsOffset, setPublicationsOffset] = useState(0)
  const [expandedId, setExpandedId] = useState<string | null>(null)
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
      toast.success(m.sites_rollback_requested())
      setPublicationsOffset(0)
      await invalidate()
    },
    onError: (error) =>
      toast.error(errorMessage(error, m.sites_rollback_failed())),
  })

  const cancelMutation = useMutation({
    mutationFn: (id: string) => cancelJobFn({ data: { id } }),
    onSuccess: async () => {
      toast.success(m.sites_job_cancelled())
      await invalidate()
    },
    onError: (error) =>
      toast.error(errorMessage(error, m.sites_cancel_job_failed())),
  })

  const publishMutation = useMutation({
    mutationFn: () => requestPublicationFn({ data: { siteId } }),
    onSuccess: async (result) => {
      if ('ok' in result && result.ok === false) {
        toast.error(m.editor_could_not_publish_site())
        return
      }
      toast.success(m.editor_publish_requested())
      await invalidate()
    },
    onError: (error) =>
      toast.error(errorMessage(error, m.editor_could_not_publish_site())),
  })

  const publicationRows: PublicationRow[] =
    publicationsQuery.data ?? EMPTY_PUBLICATIONS
  const publicationsHasMore = publicationRows.length > PUBLICATIONS_PAGE_SIZE
  const publications = publicationsHasMore
    ? publicationRows.slice(0, PUBLICATIONS_PAGE_SIZE)
    : publicationRows
  const jobs: JobRow[] = jobsQuery.data ?? EMPTY_JOBS

  const { jobsByPublication, orphanJobs } = useMemo(() => {
    const byPublication = new Map<string, JobRow[]>()
    const visible = new Set(publications.map((row) => row.id))
    const orphans: JobRow[] = []
    for (const job of jobs) {
      const key = job.publicationId
      if (!key || !visible.has(key)) {
        orphans.push(job)
        continue
      }
      const list = byPublication.get(key)
      if (list) list.push(job)
      else byPublication.set(key, [job])
    }
    return { jobsByPublication: byPublication, orphanJobs: orphans }
  }, [jobs, publications])

  function jobsFor(row: PublicationRow) {
    const linked = jobsByPublication.get(row.id)
    if (linked?.length) return linked
    return row.job ? [row.job] : EMPTY_JOBS
  }

  const logsJob = logsQuery.data as JobRow | undefined
  const logsText = logsJob?.logs || logsJob?.error || ''

  async function copyLogs() {
    if (!logsText) return
    try {
      await navigator.clipboard.writeText(logsText)
      toast.success(m.sites_logs_copied())
    } catch {
      toast.error(m.sites_copy_logs_failed())
    }
  }

  return (
    <div className="grid gap-6">
      <PageHeader
        title={m.sites_nav_releases()}
        description={m.sites_releases_description()}
      />

      <section className="grid gap-4" data-testid="publications">
        {publicationsQuery.isError ? (
          <QueryError
            title={m.sites_publications_load_error()}
            error={publicationsQuery.error}
            onRetry={() => publicationsQuery.refetch()}
            retrying={publicationsQuery.isFetching}
          />
        ) : publicationsQuery.isLoading ? (
          <div className="grid gap-3">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-16 w-full rounded-surface" />
            ))}
          </div>
        ) : publications.length === 0 ? (
          <EmptyState
            icon={<ClockCounterClockwise weight="duotone" />}
            title={m.sites_no_publications_yet()}
            description={m.sites_no_publications_description()}
            action={
              canManage ? (
                <Button
                  type="button"
                  data-testid="publish-site"
                  disabled={publishMutation.isPending}
                  onClick={() => publishMutation.mutate()}
                >
                  {publishMutation.isPending ? <Spinner /> : <Rocket />}
                  {m.editor_publish_site()}
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            <Timeline>
              {publications.map((row) => (
                <PublicationTimelineRow
                  key={row.id}
                  row={row}
                  jobs={jobsFor(row)}
                  expanded={expandedId === row.id}
                  onToggle={() =>
                    setExpandedId((current) =>
                      current === row.id ? null : row.id,
                    )
                  }
                  canManage={canManage}
                  onRollback={() => setRollbackTarget(row)}
                  onLogs={(job) => setLogsJobId(job.id)}
                  onCancel={(job) => setCancelTarget(job)}
                />
              ))}
            </Timeline>
            <ListPagination
              offset={publicationsOffset}
              limit={PUBLICATIONS_PAGE_SIZE}
              count={publications.length}
              hasMore={publicationsHasMore}
              onChange={setPublicationsOffset}
              isFetching={publicationsQuery.isFetching}
              noun={m.sites_publications_noun()}
              nounSingular={m.sites_publication_noun()}
            />
          </>
        )}

        {orphanJobs.length ? (
          <div className="grid gap-3 border-t border-border-subtle pt-6">
            <h2 className="text-ds-heading-5 text-text-primary">
              {m.releases_other_builds()}
            </h2>
            <BuildJobList
              jobs={orphanJobs}
              canManage={canManage}
              onLogs={(job) => setLogsJobId(job.id)}
              onCancel={(job) => setCancelTarget(job)}
            />
          </div>
        ) : null}
      </section>

      <ConfirmDialog
        open={rollbackTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRollbackTarget(null)
        }}
        title={m.sites_rollback_title()}
        description={
          rollbackTarget
            ? m.sites_rollback_description({
                datetime: formatDateTime(rollbackTarget.createdAt),
              })
            : undefined
        }
        confirmLabel={m.sites_rollback()}
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
        title={m.sites_cancel_job_title()}
        description={m.sites_cancel_job_description()}
        confirmLabel={m.sites_cancel_job()}
        cancelLabel={m.sites_keep_job()}
        variant="destructive"
        onConfirm={async () => {
          if (cancelTarget) await cancelMutation.mutateAsync(cancelTarget.id)
        }}
      />

      <Sheet
        open={logsJobId !== null}
        onOpenChange={(open) => {
          if (!open) setLogsJobId(null)
        }}
      >
        <SheetContent size="xl" className="gap-0 p-0">
          <SheetHeader>
            <SheetTitle>{m.sites_build_logs()}</SheetTitle>
            <SheetDescription asChild>
              <div className="flex flex-wrap items-center gap-2">
                {logsJob ? (
                  <>
                    <JobStatusBadge status={logsJob.status} />
                    <span>
                      {logsJob.attempts === 1
                        ? m.sites_logs_meta_one({
                            datetime: formatDateTime(logsJob.createdAt),
                            count: logsJob.attempts,
                          })
                        : m.sites_logs_meta_other({
                            datetime: formatDateTime(logsJob.createdAt),
                            count: logsJob.attempts,
                          })}
                    </span>
                  </>
                ) : (
                  m.sites_loading()
                )}
              </div>
            </SheetDescription>
          </SheetHeader>
          <ScrollArea className="min-h-0 flex-1 bg-background-subtle p-5">
            <pre className="text-ds-mono-xs break-all whitespace-pre-wrap text-text-secondary">
              {logsQuery.isError
                ? errorMessage(logsQuery.error, m.sites_logs_load_error())
                : logsQuery.isLoading
                  ? m.sites_loading()
                  : logsText || m.sites_no_logs()}
            </pre>
          </ScrollArea>
          <SheetFooter className="flex-row justify-end">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={!logsText}
              onClick={copyLogs}
            >
              <Copy />
              {m.sites_copy_logs()}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  )
}
