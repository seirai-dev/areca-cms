import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import {
  ArrowCounterClockwise,
  CaretDown,
  ClockCountdown,
  DotsThree,
  Lightning,
  Minus,
  RocketLaunch,
  Scroll,
  WarningCircle,
  XCircle,
} from '@phosphor-icons/react'

import { formatDateTime, shortId } from '#/lib/content/utils'
import { authClient } from '#/lib/auth-client'
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
  CheckDraw,
  ClockIcon,
  FailedIcon,
  JobStatusPill,
  LiveDot,
  PublicationStatusPill,
  SpinnerRing,
  StatusIcon,
  formatScheduleShort,
} from '#/components/ui/status-pill'
import { Switch } from '#/components/ui/switch'
import {
  RelativeTime,
  Timeline,
  TimelineCard,
  TimelineItem,
} from '#/components/ui/timeline'
import { Hint } from '#/components/ui/tooltip'
import { usePanel } from '#/features/shell/panel'
import { formatRelativeTime } from '#/lib/relative-time'
import type { MeSite } from '#/lib/site-nav'
import { EASE_STANDARD } from '#/lib/motion'
import { PUBLICATION_STATUS, isActiveJobStatus } from '#/lib/status'
import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'
import { listEntriesFn } from '#/server/fn/content'

import {
  GoLiveSteps,
  IndeterminateBar,
  changesReadyLabel,
  editorPublishReason,
} from './golive-tray'
import { parseGoLiveError } from './parse-errors'
import type { GoLiveError } from './parse-errors'
import {
  PUBLICATIONS_PAGE_SIZE,
  buildJobQuery,
  jobsQuery,
  publicationsQuery,
} from './queries'
import type { JobRow, PublicationRow } from './queries'
import {
  useCancelJob,
  useGoLive,
  useRollback,
  useReconcileDeployment,
  useResolveUncertainDeployment,
} from './use-go-live'
import { usePendingEntries } from './use-pending-entries'
import type { PendingEntry } from './use-pending-entries'
import { useReleaseStatus } from './use-release-status'
import type { ReleaseStatus } from './use-release-status'

/**
 * The Go‑live panel (brief §3.6): a right slide-over opened by
 * `?panel=golive`. Status hero, what's changing, controls (urgent + Go live),
 * validation checklist, and the release history as a timeline with build
 * details, logs, cancel and restore. Replaces the old Releases page.
 *
 * Editors see everything; actions are disabled with the reason (§1.3).
 */
export function GoLivePanel({
  site,
  canPublish,
}: {
  site: MeSite
  canPublish: boolean
}) {
  const panel = usePanel()
  const open = panel.panel === 'golive'

  return (
    <SlideOver
      open={open}
      onOpenChange={(next) => {
        if (!next) panel.close()
      }}
      title={m.golive_go_live()}
      description={site.name}
      data-testid="golive-panel"
      bodyClassName="px-0 pb-0"
    >
      {open ? (
        <GoLivePanelBody
          site={site}
          canPublish={canPublish}
          focusRelease={panel.release}
        />
      ) : null}
    </SlideOver>
  )
}

function Section({
  title,
  children,
  className,
  actions,
}: {
  title?: React.ReactNode
  children: React.ReactNode
  className?: string
  actions?: React.ReactNode
}) {
  return (
    <section className={cn('grid gap-3 px-5 py-5', className)}>
      {title ? (
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-overline text-text-muted">{title}</h3>
          {actions}
        </div>
      ) : null}
      {children}
    </section>
  )
}

function GoLivePanelBody({
  site,
  canPublish,
  focusRelease,
}: {
  site: MeSite
  canPublish: boolean
  focusRelease?: string
}) {
  const release = useReleaseStatus(site.id)
  const { goLive, isPending, errors, clearErrors } = useGoLive(site.id)
  const [urgent, setUrgent] = React.useState(false)
  const pending = usePendingEntries({
    siteId: site.id,
    enabled: release.state !== 'loading',
  })

  return (
    <div className="grid divide-y divide-border-default">
      {release.data?.publishingMode === 'demo' ? (
        <Section>
          <p data-testid="demo-publication-label" role="status">
            Demo mode ·{' '}
            {release.data.demo
              ? 'Demo publication ready'
              : 'No demo publication yet'}{' '}
            · Never production live
          </p>
        </Section>
      ) : (
        <StatusHero site={site} release={release} />
      )}

      {errors.length > 0 ? (
        <Section>
          <ErrorChecklist
            siteId={site.id}
            errors={errors}
            onDismiss={clearErrors}
          />
        </Section>
      ) : null}

      <Section
        title={m.golive_whats_changing()}
        actions={
          pending.ready.length > 0 ? (
            <span className="text-caption font-normal text-text-muted tnum">
              {pending.ready.length}
            </span>
          ) : null
        }
      >
        <WhatsChanging siteId={site.id} pending={pending} />
      </Section>

      <Section>
        <div className="grid gap-4">
          <label
            className={cn(
              'flex items-center justify-between gap-4 rounded-[12px] bg-background-subtle px-3.5 py-3',
              !canPublish && 'opacity-60',
            )}
          >
            <span className="grid gap-0.5">
              <span className="flex items-center gap-1.5 text-[14px] leading-5 font-medium text-text-primary">
                <Lightning weight="fill" className="size-4 text-icon-warning" />
                {m.golive_urgent()}
              </span>
              <span className="text-callout text-text-secondary">
                {m.golive_urgent_hint()}
              </span>
            </span>
            <Switch
              checked={urgent}
              onCheckedChange={setUrgent}
              disabled={!canPublish}
              data-testid="golive-urgent"
              aria-label={m.golive_urgent()}
            />
          </label>
          <Hint
            label={canPublish ? null : editorPublishReason()}
            wrapDisabled={!canPublish}
            className="w-full"
          >
            <Button
              type="button"
              size="lg"
              className="w-full"
              data-testid="publish-site-confirm"
              disabled={!canPublish || release.state === 'going-live'}
              loading={isPending}
              onClick={() => void goLive({ urgent })}
            >
              {isPending ? null : <RocketLaunch weight="fill" />}
              {release.state === 'going-live'
                ? m.golive_going_live()
                : m.golive_go_live()}
            </Button>
          </Hint>
          {!canPublish ? (
            <p className="text-center text-callout text-text-secondary">
              {editorPublishReason()}
            </p>
          ) : null}
        </div>
      </Section>

      <ReleaseHistory
        siteId={site.id}
        canManage={canPublish}
        focusRelease={focusRelease}
      />
    </div>
  )
}

/* -------------------------------------------------------------------------
   Status hero
------------------------------------------------------------------------- */

function StatusHero({
  site,
  release,
}: {
  site: MeSite
  release: ReleaseStatus
}) {
  const reduce = useReducedMotion()
  const { state, pending } = release

  let icon: React.ReactNode
  let tone: string
  let sentence: string
  let detail: React.ReactNode = null

  switch (state) {
    case 'loading':
      return (
        <div className="flex items-center gap-4 px-5 pt-2 pb-6">
          <Skeleton className="size-12 rounded-[14px]" />
          <div className="grid flex-1 gap-2">
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-4 w-1/3" />
          </div>
        </div>
      )
    case 'going-live':
      icon = <SpinnerRing size={24} />
      tone = 'bg-accent-soft text-icon-accent'
      sentence = m.golive_hero_going_live({ site: site.name })
      detail = (
        <div className="grid gap-2.5 pt-1">
          <GoLiveSteps step={release.step} />
          <IndeterminateBar />
        </div>
      )
      break
    case 'failed':
      icon = <FailedIcon size={24} />
      tone = 'bg-status-error-bg text-icon-error'
      sentence = release.live
        ? m.golive_hero_failed()
        : m.golive_hero_failed_never_live()
      detail = release.lastFailure?.error ? (
        <p
          className="line-clamp-3 text-callout text-text-secondary"
          title={release.lastFailure.error}
        >
          {release.lastFailure.error}
        </p>
      ) : null
      break
    case 'never-live':
      icon = <RocketLaunch weight="fill" className="size-6" />
      tone = 'bg-accent-soft text-icon-accent'
      sentence =
        pending > 0
          ? m.golive_hero_not_live_ready({
              site: site.name,
              changes: changesReadyLabel(pending).toLowerCase(),
            })
          : m.golive_hero_not_live({ site: site.name })
      detail =
        pending > 0 ? null : (
          <p className="text-callout text-text-secondary">
            {m.golive_never_live_hint()}
          </p>
        )
      break
    case 'ready':
      icon = <RocketLaunch weight="fill" className="size-6" />
      tone = 'bg-accent-soft text-icon-accent'
      sentence = m.golive_hero_ready({
        site: site.name,
        changes: changesReadyLabel(pending).toLowerCase(),
      })
      break
    case 'up-to-date':
      icon = <CheckDraw size={24} circle={false} />
      tone = 'bg-status-success-bg text-icon-success'
      sentence = m.golive_hero_up_to_date({ site: site.name })
      break
  }

  return (
    <div
      className="grid gap-3 px-5 pt-2 pb-6"
      aria-live="polite"
      data-testid="golive-hero"
      data-state={state}
    >
      <div className="flex items-start gap-4">
        <motion.span
          key={state}
          initial={reduce ? false : { scale: 0.85, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.25, ease: EASE_STANDARD }}
          className={cn(
            'grid size-12 shrink-0 place-content-center rounded-[14px]',
            tone,
          )}
        >
          {icon}
        </motion.span>
        <div className="grid min-w-0 gap-1 pt-0.5">
          <p className="text-[17px] leading-6 font-semibold tracking-[-0.012em] text-balance text-text-primary">
            {sentence}
          </p>
          {release.liveSince ? (
            <p
              className="flex items-center gap-1.5 text-callout text-text-secondary"
              data-testid="release-live"
            >
              <LiveDot pulse="none" />
              {m.golive_live_since({
                time: formatRelativeTime(release.liveSince),
              })}
              <a
                href={site.productionUrl}
                target="_blank"
                rel="noreferrer"
                className="truncate text-text-accent hover:underline"
              >
                {site.productionUrl
                  .replace(/^https?:\/\//, '')
                  .replace(/\/$/, '')}
              </a>
            </p>
          ) : null}
        </div>
      </div>
      {detail}
    </div>
  )
}

/* -------------------------------------------------------------------------
   What's changing
------------------------------------------------------------------------- */

function WhatsChanging({
  siteId,
  pending,
}: {
  siteId: string
  pending: ReturnType<typeof usePendingEntries>
}) {
  if (pending.isLoading) {
    return (
      <div className="grid gap-2">
        {Array.from({ length: 3 }).map((_, index) => (
          <Skeleton key={index} className="h-11 w-full rounded-[10px]" />
        ))}
      </div>
    )
  }
  if (pending.entries.length === 0) {
    return (
      <p className="rounded-[12px] border border-dashed border-border-strong px-4 py-4 text-center text-callout text-text-secondary">
        {m.golive_nothing_changing()}
      </p>
    )
  }
  return (
    <ul className="-mx-2 grid" data-testid="golive-changes">
      {pending.entries.map((entry) => (
        <li key={`${entry.kind}-${entry.id}`}>
          <PendingRow siteId={siteId} entry={entry} />
        </li>
      ))}
    </ul>
  )
}

function PendingRow({
  siteId,
  entry,
}: {
  siteId: string
  entry: PendingEntry
}) {
  const meta =
    entry.kind === 'scheduled' && entry.scheduledAt
      ? m.golive_scheduled_for({
          time: formatScheduleShort(entry.scheduledAt),
        })
      : entry.kind === 'removal'
        ? m.golive_will_leave_live()
        : entry.updatedByName
          ? m.golive_edited_by({
              time: formatRelativeTime(entry.updatedAt),
              name: entry.updatedByName,
            })
          : m.golive_edited({ time: formatRelativeTime(entry.updatedAt) })

  const icon =
    entry.kind === 'scheduled' ? (
      <ClockIcon size={16} className="text-icon-warning" />
    ) : entry.kind === 'removal' ? (
      <Minus className="size-3.5 text-icon-muted" />
    ) : (
      <span className="size-2 rounded-full bg-accent" />
    )

  const body = (
    <>
      <span className="grid size-6 shrink-0 place-content-center">{icon}</span>
      <span className="grid min-w-0 flex-1">
        <span className="truncate text-[14px] leading-5 font-medium text-text-primary">
          {entry.title}
        </span>
        <span className="truncate text-[12px] leading-4 text-text-muted">
          {entry.collectionLabel}
          {' · '}
          {meta}
        </span>
      </span>
    </>
  )

  const className =
    'group/row flex min-h-11 items-center gap-3 rounded-[10px] px-2 py-1.5 outline-none transition-colors hover:bg-surface-state-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-border-focus'

  if (!entry.exists) {
    return <div className={className}>{body}</div>
  }

  return (
    <Link
      to="/sites/$siteId/c/$collectionKey/$entryId"
      params={{ siteId, collectionKey: entry.collectionKey, entryId: entry.id }}
      className={className}
    >
      {body}
    </Link>
  )
}

/* -------------------------------------------------------------------------
   Validation errors
------------------------------------------------------------------------- */

function ErrorChecklist({
  siteId,
  errors,
  onDismiss,
}: {
  siteId: string
  errors: string[]
  onDismiss: () => void
}) {
  const parsed = errors.map(parseGoLiveError)
  return (
    <div
      role="alert"
      data-testid="golive-errors"
      className="grid gap-3 rounded-[14px] bg-status-error-bg px-4 py-3.5"
    >
      <div className="flex items-center gap-2">
        <WarningCircle weight="fill" className="size-[18px] text-icon-error" />
        <span className="flex-1 text-[14px] leading-5 font-semibold text-text-primary">
          {m.golive_fix_first()}
        </span>
        <Button type="button" variant="quiet" size="xs" onClick={onDismiss}>
          {m.golive_dismiss()}
        </Button>
      </div>
      <ul className="grid gap-1.5">
        {parsed.map((error) => (
          <ErrorItem key={error.raw} siteId={siteId} error={error} />
        ))}
      </ul>
    </div>
  )
}

function ErrorItem({ siteId, error }: { siteId: string; error: GoLiveError }) {
  const lookup = useQuery({
    queryKey: ['golive-error-entry', siteId, error.collection, error.slug],
    queryFn: async () => {
      const result = await listEntriesFn({
        data: {
          siteId,
          collectionKey: error.collection!,
          search: error.slug,
          limit: 10,
          offset: 0,
        },
      })
      return result.items.find((item) => item.slug === error.slug) ?? null
    },
    enabled: Boolean(error.collection && error.slug),
    staleTime: 60_000,
  })
  const found = lookup.data
  return (
    <li className="flex items-start gap-2.5 text-callout">
      <span
        aria-hidden="true"
        className="mt-[5px] size-2 shrink-0 rounded-[3px] border-[1.5px] border-text-error"
      />
      <span className="min-w-0 text-text-primary">
        {error.slug ? (
          found ? (
            <Link
              to="/sites/$siteId/c/$collectionKey/$entryId"
              params={{
                siteId,
                collectionKey: error.collection!,
                entryId: found.id,
              }}
              className="font-medium text-text-accent hover:underline"
            >
              {error.slug}
            </Link>
          ) : (
            <span className="font-medium">{error.slug}</span>
          )
        ) : null}
        {error.field ? (
          <span className="text-text-secondary">
            {error.slug ? ' · ' : ''}
            {error.field}
          </span>
        ) : null}
        {error.slug || error.field ? ': ' : ''}
        <span className="text-text-secondary">{error.message}</span>
      </span>
    </li>
  )
}

/* -------------------------------------------------------------------------
   Release history
------------------------------------------------------------------------- */

function canRestore(row: PublicationRow) {
  return row.wasLive && row.status !== 'live'
}

function ReleaseHistory({
  siteId,
  canManage,
  focusRelease,
}: {
  siteId: string
  canManage: boolean
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
  const reconcile = useReconcileDeployment(siteId)
  const resolveUncertain = useResolveUncertainDeployment(siteId)
  const isAgencyAdmin =
    authClient.useSession().data?.user.isAgencyAdmin === true
  const [resolutionReasons, setResolutionReasons] = React.useState<
    Record<string, string>
  >({})

  const limit = PUBLICATIONS_PAGE_SIZE * pages
  const rows = (publications.data ?? []).slice(0, limit)
  const hasMore = (publications.data?.length ?? 0) > limit

  const { byPublication, others } = React.useMemo(() => {
    const map = new Map<string, JobRow[]>()
    const visible = new Set(rows.map((row) => row.id))
    const rest: JobRow[] = []
    for (const job of jobs.data ?? []) {
      if (!job.publicationId || !visible.has(job.publicationId)) {
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
        .filter((job) => job.dispatchUncertain)
        .map((job) => (
          <div
            key={job.id}
            className="grid gap-2 rounded-[10px] bg-background-subtle p-3"
          >
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
                  value={resolutionReasons[job.id] ?? ''}
                  onChange={(event) =>
                    setResolutionReasons((previous) => ({
                      ...previous,
                      [job.id]: event.target.value,
                    }))
                  }
                />
                <ConfirmDialog
                  title={m.golive_resolve_uncertain()}
                  description={m.golive_resolve_uncertain_confirmation()}
                  confirmText={job.id}
                  confirmLabel={m.golive_resolve_uncertain()}
                  variant="destructive"
                  onConfirm={() =>
                    resolveUncertain
                      .mutateAsync({
                        id: job.id,
                        reason: resolutionReasons[job.id] ?? '',
                      })
                      .then(() => undefined)
                  }
                >
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={
                      (resolutionReasons[job.id] ?? '').trim().length < 10 ||
                      job.status !== 'failed'
                    }
                  >
                    {m.golive_resolve_uncertain()}
                  </Button>
                </ConfirmDialog>
              </div>
            ) : null}
          </div>
        ))}
      {publications.isError ? (
        <QueryError
          title={m.golive_releases_load_error()}
          error={publications.error}
          onRetry={() => void publications.refetch()}
          retrying={publications.isFetching}
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
          {m.golive_no_releases()}
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
          if (restoreTarget) await rollback.mutateAsync(restoreTarget.id)
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
          if (cancelTarget) await cancelJob.mutateAsync(cancelTarget.id)
        }}
      />
      <BuildLogSheet jobId={logJobId} onClose={() => setLogJobId(null)} />
    </Section>
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
      meta={
        row.requestedByName
          ? m.golive_by({ name: row.requestedByName })
          : m.golive_by_system()
      }
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
