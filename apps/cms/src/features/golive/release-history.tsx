import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { useRouteContext } from '@tanstack/react-router'
import { AnimatePresence, useReducedMotion } from 'motion/react'
import * as motion from 'motion/react-m'
import {
  ArrowCounterClockwise,
  CaretDown,
  ClockCountdown,
  DotsThree,
  Scroll,
  XCircle,
} from '@phosphor-icons/react'

import { formatDateTime, shortId } from '#/lib/content/utils'
import { Input } from '#/components/ui/input'
import { Button } from '#/components/ui/button'
import { ConfirmDialog } from '#/components/ui/confirm-dialog'
import { CopyButton } from '#/components/ui/copy-button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { QueryError } from '#/components/ui/query-error'
import { Skeleton } from '#/components/ui/skeleton'
import { SlideOver } from '#/components/ui/slide-over'
import {
  JobStatusPill,
  PublicationStatusPill,
  StatusIcon,
} from '#/components/ui/status-pill'
import {
  RelativeTime,
  Timeline,
  TimelineCard,
  TimelineItem,
} from '#/components/ui/timeline'
import { Hint } from '#/components/ui/tooltip'
import { EASE_STANDARD } from '#/lib/motion'
import { PUBLICATION_STATUS, isActiveJobStatus } from '#/lib/status'
import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'

import { editorPublishReason } from './golive-tray'
import { Section } from './panel-section'
import { releaseRequesterKey } from './release-requester'
import {
  PUBLICATIONS_PAGE_SIZE,
  buildJobQuery,
  jobsQuery,
  publicationsQuery,
} from './queries'
import type { JobRow, PublicationOrigin, PublicationRow } from './queries'
import {
  useCancelJob,
  useRollback,
  useReconcileDeployment,
  useResolveUncertainDeployment,
} from './use-go-live'

function canRestore(row: PublicationRow) {
  return row.wasLive && row.status !== 'live'
}

export function ReleaseHistory({
  siteId,
  canManage,
  demo = false,
  focusRelease,
}: {
  siteId: string
  canManage: boolean
  demo?: boolean
  focusRelease?: string
}) {
  const [pages, setPages] = React.useState(1)
  const [expanded, setExpanded] = React.useState<string | null>(
    focusRelease ?? null,
  )
  const [restoreTarget, setRestoreTarget] =
    React.useState<PublicationRow | null>(null)
  const [cancelTarget, setCancelTarget] = React.useState<JobRow | null>(null)
  const [logJobId, setLogJobId] = React.useState<string | null>(null)
  const [othersOpen, setOthersOpen] = React.useState(false)

  const publications = useQuery({
    ...publicationsQuery(siteId, pages),
    placeholderData: (previous) => previous,
  })
  const jobs = useQuery(jobsQuery(siteId))
  const rollback = useRollback(siteId)
  const cancelJob = useCancelJob(siteId)
  const isAgencyAdmin = useRouteContext({ from: '/_app' }).me.user.isAgencyAdmin

  const limit = PUBLICATIONS_PAGE_SIZE * pages
  const rows = (publications.data ?? []).slice(0, limit)
  const hasMore = (publications.data?.length ?? 0) > limit

  const { byPublication, others } = React.useMemo(() => {
    const map = new Map<string, JobRow[]>()
    const visible = new Set(rows.map((row) => row.id))
    const rest: JobRow[] = []
    for (const job of jobs.data ?? []) {
      if (!visible.has(job.publicationId)) {
        rest.push(job)
        continue
      }
      const list = map.get(job.publicationId)
      if (list) list.push(job)
      else map.set(job.publicationId, [job])
    }
    return { byPublication: map, others: rest }
  }, [jobs.data, rows])

  // "See what happened": bring the requested release into view.
  React.useEffect(() => {
    if (!focusRelease) return
    setExpanded(focusRelease)
    const timer = window.setTimeout(() => {
      document
        .querySelector(`[data-release-id="${CSS.escape(focusRelease)}"]`)
        ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }, 350)
    return () => window.clearTimeout(timer)
  }, [focusRelease, publications.isSuccess])

  return (
    <Section title={m.golive_releases()} className="pb-8">
      {(jobs.data ?? [])
        // Every deploy is marked uncertain while it runs; only a job that
        // stopped with that mark needs someone to check it.
        .filter(
          (job) => job.dispatchUncertain && !isActiveJobStatus(job.status),
        )
        .map((job) => (
          <UncertainDeploymentCard
            key={job.id}
            siteId={siteId}
            job={job}
            canManage={canManage}
            isAgencyAdmin={isAgencyAdmin}
          />
        ))}
      {publications.isError ? (
        <QueryError
          title={m.golive_releases_load_error()}
          query={publications}
        />
      ) : publications.isLoading ? (
        <div className="grid gap-4">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="flex gap-3">
              <Skeleton className="size-7 rounded-full" />
              <div className="grid flex-1 gap-2">
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-3 w-1/3" />
              </div>
            </div>
          ))}
        </div>
      ) : rows.length === 0 ? (
        <p className="text-callout text-text-secondary">
          {demo ? m.golive_demo_no_releases() : m.golive_no_releases()}
        </p>
      ) : (
        <>
          <Timeline data-testid="publications">
            {rows.map((row) => {
              const linked = byPublication.get(row.id)
              const rowJobs = linked?.length ? linked : row.job ? [row.job] : []
              return (
                <ReleaseItem
                  key={row.id}
                  row={row}
                  jobs={rowJobs}
                  canManage={canManage}
                  expanded={expanded === row.id}
                  onToggle={() =>
                    setExpanded((current) =>
                      current === row.id ? null : row.id,
                    )
                  }
                  onRestore={() => setRestoreTarget(row)}
                  onLog={(job) => setLogJobId(job.id)}
                  onCancel={(job) => setCancelTarget(job)}
                />
              )
            })}
          </Timeline>
          {hasMore ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="justify-self-start"
              loading={publications.isFetching}
              onClick={() => setPages((value) => value + 1)}
              data-testid="golive-show-older"
            >
              {m.golive_show_older()}
            </Button>
          ) : null}
        </>
      )}

      {others.length > 0 ? (
        <div className="mt-2 grid gap-2 border-t border-border-default pt-4">
          <button
            type="button"
            aria-expanded={othersOpen}
            onClick={() => setOthersOpen((value) => !value)}
            className="flex items-center gap-1.5 justify-self-start rounded-[6px] text-callout font-medium text-text-secondary outline-none hover:text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
          >
            <CaretDown
              weight="bold"
              className={cn(
                'size-3 transition-transform',
                !othersOpen && '-rotate-90',
              )}
            />
            {m.releases_other_builds()}
            <span className="text-text-muted tnum">{others.length}</span>
          </button>
          {othersOpen ? (
            <JobList
              jobs={others}
              canManage={canManage}
              onLog={(job) => setLogJobId(job.id)}
              onCancel={(job) => setCancelTarget(job)}
            />
          ) : null}
        </div>
      ) : null}

      <ConfirmDialog
        open={restoreTarget !== null}
        onOpenChange={(next) => {
          if (!next) setRestoreTarget(null)
        }}
        title={m.golive_restore_title()}
        description={
          restoreTarget
            ? m.golive_restore_description({
                datetime: formatDateTime(restoreTarget.createdAt),
              })
            : undefined
        }
        confirmLabel={m.golive_restore()}
        onConfirm={async () => {
          // The mutation shows its own error toast.
          if (restoreTarget)
            await rollback.mutateAsync(restoreTarget.id).catch(() => undefined)
        }}
      />
      <ConfirmDialog
        open={cancelTarget !== null}
        onOpenChange={(next) => {
          if (!next) setCancelTarget(null)
        }}
        title={m.sites_cancel_job_title()}
        description={m.sites_cancel_job_description()}
        confirmLabel={m.sites_cancel_job()}
        cancelLabel={m.sites_keep_job()}
        variant="destructive"
        onConfirm={async () => {
          if (cancelTarget)
            await cancelJob.mutateAsync(cancelTarget.id).catch(() => undefined)
        }}
      />
      <BuildLogSheet jobId={logJobId} onClose={() => setLogJobId(null)} />
    </Section>
  )
}

/**
 * A deploy that stopped while marked uncertain: anyone who can publish asks
 * the provider again; an agency admin can resolve it by hand with a reason.
 */
function UncertainDeploymentCard({
  siteId,
  job,
  canManage,
  isAgencyAdmin,
}: {
  siteId: string
  job: JobRow
  canManage: boolean
  isAgencyAdmin: boolean
}) {
  const reconcile = useReconcileDeployment(siteId)
  const resolveUncertain = useResolveUncertainDeployment(siteId)
  const [reason, setReason] = React.useState('')

  return (
    <div className="grid gap-2 rounded-[10px] bg-background-subtle p-3">
      <p className="text-callout text-text-secondary">
        {m.golive_deployment_uncertain()}
      </p>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={!canManage}
        loading={reconcile.isPending}
        onClick={() => reconcile.mutate(job.id)}
        data-testid="reconcile-deployment"
      >
        {m.golive_reconcile_deployment()}
      </Button>
      {isAgencyAdmin ? (
        <div className="grid gap-2">
          <Input
            aria-label={m.golive_resolution_reason()}
            placeholder={m.golive_resolution_reason()}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
          <ConfirmDialog
            title={m.golive_resolve_uncertain()}
            description={m.golive_resolve_uncertain_confirmation()}
            confirmText={job.id}
            confirmLabel={m.golive_resolve_uncertain()}
            variant="destructive"
            onConfirm={async () => {
              // The mutation shows its own error toast.
              await resolveUncertain
                .mutateAsync({ id: job.id, reason })
                .catch(() => undefined)
            }}
          >
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={reason.trim().length < 10 || job.status !== 'failed'}
            >
              {m.golive_resolve_uncertain()}
            </Button>
          </ConfirmDialog>
        </div>
      ) : null}
    </div>
  )
}

function ReleaseItem({
  row,
  jobs,
  canManage,
  expanded,
  onToggle,
  onRestore,
  onLog,
  onCancel,
}: {
  row: PublicationRow
  jobs: JobRow[]
  canManage: boolean
  expanded: boolean
  onToggle: () => void
  onRestore: () => void
  onLog: (job: JobRow) => void
  onCancel: (job: JobRow) => void
}) {
  const reduce = useReducedMotion()
  const meta = PUBLICATION_STATUS[row.status]
  const restorable = canRestore(row)
  const detailsId = React.useId()

  return (
    <TimelineItem
      data-testid={`publication-${row.status}`}
      data-release-id={row.id}
      tone={meta.tone}
      icon={
        <StatusIcon kind={meta.icon} tone={meta.tone} size={14} pulse="none" />
      }
      title={
        <span className="inline-flex items-center gap-2">
          {meta.title()}
          {row.status === 'live' ? (
            <PublicationStatusPill
              status={row.status}
              size="sm"
              testId={`publication-status-${row.status}`}
            />
          ) : (
            <span
              className="sr-only"
              data-testid={`publication-status-${row.status}`}
            >
              {meta.label()}
            </span>
          )}
        </span>
      }
      time={<RelativeTime value={row.createdAt} />}
      meta={requesterLabel(row)}
      actions={
        restorable ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="quiet"
                size="icon-xs"
                aria-label={m.releases_actions()}
                data-testid="publication-menu"
              >
                <DotsThree weight="bold" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                data-testid="rollback-publication"
                disabled={!canManage}
                onSelect={onRestore}
              >
                <ArrowCounterClockwise />
                {m.golive_restore()}
              </DropdownMenuItem>
              {!canManage ? (
                <p className="max-w-60 px-2.5 pb-1.5 text-caption font-normal text-text-muted">
                  {editorPublishReason()}
                </p>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null
      }
    >
      <div className="grid gap-2">
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={detailsId}
          onClick={onToggle}
          className="flex items-center gap-1 justify-self-start rounded-[6px] text-[12.5px] font-medium text-text-secondary outline-none hover:text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
        >
          <CaretDown
            weight="bold"
            className={cn(
              'size-3 transition-transform duration-150 motion-reduce:transition-none',
              !expanded && '-rotate-90',
            )}
          />
          {m.golive_details()}
        </button>
        <AnimatePresence initial={false}>
          {expanded ? (
            <motion.div
              id={detailsId}
              key="details"
              initial={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
              transition={{ duration: reduce ? 0 : 0.2, ease: EASE_STANDARD }}
              className="overflow-hidden"
            >
              <TimelineCard className="grid gap-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-caption font-normal text-text-muted">
                    {m.golive_snapshot()}
                  </span>
                  <span className="flex items-center gap-1">
                    <code
                      className="bg-transparent p-0 text-mono text-text-secondary"
                      title={row.snapshotHash}
                    >
                      {shortId(row.snapshotHash, 12)}
                    </code>
                    <CopyButton value={row.snapshotHash} size="icon-xs" />
                  </span>
                </div>
                {restorable ? (
                  <Hint
                    label={canManage ? null : editorPublishReason()}
                    wrapDisabled={!canManage}
                  >
                    <Button
                      type="button"
                      variant="secondary"
                      size="xs"
                      className="justify-self-start"
                      disabled={!canManage}
                      onClick={onRestore}
                      data-testid="restore-release"
                    >
                      <ArrowCounterClockwise />
                      {m.golive_restore()}
                    </Button>
                  </Hint>
                ) : null}
                <JobList
                  jobs={jobs}
                  canManage={canManage}
                  onLog={onLog}
                  onCancel={onCancel}
                />
              </TimelineCard>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </TimelineItem>
  )
}

function duration(job: JobRow) {
  if (!job.startedAt) return null
  const start = new Date(job.startedAt).getTime()
  const end = job.finishedAt ? new Date(job.finishedAt).getTime() : Date.now()
  const seconds = Math.round((end - start) / 1000)
  if (!Number.isFinite(seconds) || seconds < 0) return null
  return seconds < 60
    ? `${seconds}s`
    : `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

/** Build steps behind a release: status, duration, attempts, log, cancel. */
function JobList({
  jobs,
  canManage,
  onLog,
  onCancel,
}: {
  jobs: JobRow[]
  canManage: boolean
  onLog: (job: JobRow) => void
  onCancel: (job: JobRow) => void
}) {
  if (jobs.length === 0) {
    return (
      <p className="text-caption font-normal text-text-muted">
        {m.releases_no_jobs()}
      </p>
    )
  }
  return (
    <ul className="grid gap-1" data-testid="build-jobs">
      {jobs.map((job) => {
        const took = duration(job)
        return (
          <li
            key={job.id}
            data-testid={`build-job-${job.status}`}
            className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-[10px] bg-background-subtle px-2.5 py-2"
          >
            <JobStatusPill status={job.status} size="sm" />
            <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 text-caption font-normal text-text-muted tnum">
              <RelativeTime value={job.createdAt} />
              {took ? <span>· {took}</span> : null}
              <span>
                ·{' '}
                {job.attempts === 1
                  ? m.sites_attempts_one({ count: job.attempts })
                  : m.sites_attempts_other({ count: job.attempts })}
              </span>
            </span>
            <span className="flex items-center gap-1">
              <Button
                type="button"
                size="xs"
                variant="quiet"
                onClick={() => onLog(job)}
                data-testid="view-log"
              >
                <Scroll />
                {m.golive_view_log()}
              </Button>
              {job.status === 'queued' ? (
                <Hint
                  label={canManage ? null : editorPublishReason()}
                  wrapDisabled={!canManage}
                >
                  <Button
                    type="button"
                    size="xs"
                    variant="quiet"
                    className="text-text-error hover:text-text-error"
                    disabled={!canManage}
                    onClick={() => onCancel(job)}
                    data-testid="cancel-job"
                  >
                    <XCircle />
                    {m.sites_cancel()}
                  </Button>
                </Hint>
              ) : null}
            </span>
            {job.status === 'failed' && job.error ? (
              <p className="w-full text-caption font-normal text-text-error">
                {job.error}
              </p>
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}

/** Nested sheet with the monospaced build log; refreshes while active. */
function BuildLogSheet({
  jobId,
  onClose,
}: {
  jobId: string | null
  onClose: () => void
}) {
  const query = useQuery({
    ...buildJobQuery(jobId ?? ''),
    enabled: Boolean(jobId),
  })
  const job = query.data
  const text = job?.logs || job?.error || ''
  const live = job ? isActiveJobStatus(job.status) : false

  return (
    <SlideOver
      open={jobId !== null}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      nested
      size="lg"
      title={m.sites_build_logs()}
      description={
        job
          ? `${job.attempts === 1 ? m.sites_logs_meta_one({ datetime: formatDateTime(job.createdAt), count: job.attempts }) : m.sites_logs_meta_other({ datetime: formatDateTime(job.createdAt), count: job.attempts })}`
          : m.sites_loading()
      }
      data-testid="build-log"
      headerActions={
        <div className="flex items-center gap-1.5 pt-0.5">
          {job ? <JobStatusPill status={job.status} size="sm" /> : null}
          <CopyButton
            value={text}
            disabled={!text}
            toastMessage={m.sites_logs_copied()}
            aria-label={m.sites_copy_logs()}
          />
        </div>
      }
      bodyClassName="px-0 pb-0"
    >
      <div className="grid h-full grid-rows-[1fr_auto]">
        <pre className="scroll-quiet min-h-0 overflow-auto bg-background-subtle px-5 py-4 text-mono [overflow-wrap:anywhere] whitespace-pre-wrap text-text-secondary">
          {query.isError
            ? m.sites_logs_load_error()
            : query.isLoading
              ? m.sites_loading()
              : text || m.sites_no_logs()}
        </pre>
        {live ? (
          <p className="flex items-center gap-2 border-t border-border-default px-5 py-2.5 text-caption font-normal text-text-muted">
            <ClockCountdown className="size-3.5" />
            {m.golive_log_live()}
          </p>
        ) : null}
      </div>
    </SlideOver>
  )
}

/** "by Jane", "Started automatically" for the scheduler, "by Deleted user". */
function requesterLabel(row: {
  requestedByName: string | null
  origin: PublicationOrigin
}) {
  const requester = releaseRequesterKey(row)
  if (requester.kind === 'person') return m.golive_by({ name: requester.name })
  if (requester.kind === 'automatic') return m.golive_by_system()
  return m.golive_by({ name: m.people_deleted_user() })
}
