import * as React from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { ArrowClockwise, CaretDown, PauseCircle } from '@phosphor-icons/react'

import { Button } from '#/components/ui/button'
import { QueryError } from '#/components/ui/query-error'
import { SettingsSection } from '#/components/ui/settings-section'
import { Skeleton } from '#/components/ui/skeleton'
import { absoluteTimeLabel, formatRelativeTime } from '#/lib/relative-time'
import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'

import {
  clientDiffersFromSite,
  errorSummary,
  pausedRows,
  storageFileName,
} from './paused-jobs-logic'
import type { PausedRow } from './paused-jobs-logic'
import { usePausedJobAction, usePausedJobs } from './use-paused-jobs'

/**
 * Agency → Mail: work that stopped after four failed attempts. Retry starts a
 * new attempt cycle. Dismiss hides the item and deletes nothing. One surface
 * holds every row; the full error, key and dismiss sit behind Details.
 */
export function PausedJobsSection() {
  const query = usePausedJobs()
  const retry = usePausedJobAction('retry')
  const dismiss = usePausedJobAction('dismiss')
  const rows = pausedRows(query.data)

  return (
    <SettingsSection
      id="paused-jobs"
      bare
      title={m.agency_paused_title()}
      description={m.agency_paused_description()}
      data-testid="paused-jobs"
    >
      {query.isError ? (
        <QueryError
          title={m.agency_paused_load_error()}
          error={query.error}
          onRetry={() => void query.refetch()}
          retrying={query.isFetching}
        />
      ) : query.isPending ? (
        <Skeleton className="h-16 rounded-card" />
      ) : rows.length === 0 ? (
        <div className="surface-card px-4 py-4">
          <p
            className="text-callout text-text-secondary"
            data-testid="paused-jobs-empty"
          >
            {m.agency_paused_empty()}
          </p>
        </div>
      ) : (
        <ul
          className="surface-card divide-y divide-border-default overflow-hidden"
          data-testid="paused-jobs-list"
        >
          {rows.map((row) => {
            const busy =
              (retry.isPending && retry.variables.id === row.id) ||
              (dismiss.isPending && dismiss.variables.id === row.id)
            return (
              <PausedJobRow
                key={row.key}
                row={row}
                busy={busy}
                onRetry={() => retry.mutate({ kind: row.kind, id: row.id })}
                onDismiss={() => dismiss.mutate({ kind: row.kind, id: row.id })}
              />
            )
          })}
        </ul>
      )}
    </SettingsSection>
  )
}

function PausedJobRow({
  row,
  busy,
  onRetry,
  onDismiss,
}: {
  row: PausedRow
  busy: boolean
  onRetry: () => void
  onDismiss: () => void
}) {
  const [open, setOpen] = React.useState(false)
  const detailsId = React.useId()
  const title =
    row.kind === 'storage'
      ? storageFileName(row.storageKey ?? row.id)
      : m.agency_paused_schedule_title({ site: row.siteName ?? '' })
  const summary = errorSummary(row.lastError)
  const when = formatRelativeTime(row.at, { withinDays: 7 })
  const absolute = absoluteTimeLabel(row.at)
  const count = String(row.attempts)

  const sentence =
    row.kind === 'storage'
      ? m.agency_paused_storage_reason({ count, time: when })
      : row.organizationName &&
          row.siteName &&
          clientDiffersFromSite(row.siteName, row.organizationName)
        ? m.agency_paused_schedule_reason_client({
            client: row.organizationName,
            count,
            time: when,
          })
        : m.agency_paused_schedule_reason({ count, time: when })

  return (
    <li
      className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 px-4 py-3"
      data-testid="paused-job-row"
      data-kind={row.kind}
    >
      <div className="grid min-w-0 gap-1">
        <div className="flex min-h-[30px] min-w-0 items-center gap-2">
          <PauseCircle
            aria-hidden="true"
            className="size-4 shrink-0 text-icon-warning"
          />
          <span
            className="min-w-0 break-words text-[14px] leading-5 font-medium text-text-primary"
            title={row.storageKey ?? title}
          >
            {title}
          </span>
        </div>
        <p
          className="sm:pl-6 text-callout text-text-secondary"
          title={absolute}
        >
          {sentence}
        </p>
        {summary ? (
          <p className="truncate font-mono text-caption text-text-secondary sm:pl-6">
            {summary}
          </p>
        ) : null}
        <div className="sm:pl-6">
          <Button
            type="button"
            variant="quiet"
            size="sm"
            aria-expanded={open}
            aria-controls={open ? detailsId : undefined}
            data-testid="paused-job-details"
            className="-ml-2"
            onClick={() => setOpen((value) => !value)}
          >
            {open ? m.agency_paused_hide_details() : m.agency_paused_details()}
            <CaretDown
              aria-hidden="true"
              className={cn(
                'transition-transform duration-150 motion-reduce:transition-none',
                open && 'rotate-180',
              )}
            />
          </Button>
        </div>
        <PausedJobDetails
          id={detailsId}
          open={open}
          row={row}
          busy={busy}
          onDismiss={onDismiss}
        />
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-label={m.agency_paused_retry_aria({ title })}
        data-testid="paused-job-retry"
        disabled={busy}
        onClick={onRetry}
      >
        <ArrowClockwise />
        {m.agency_paused_retry()}
      </Button>
    </li>
  )
}

/** The full error, the storage key or client and site, the absolute time, and Dismiss. */
function PausedJobDetails({
  id,
  open,
  row,
  busy,
  onDismiss,
}: {
  id: string
  open: boolean
  row: PausedRow
  busy: boolean
  onDismiss: () => void
}) {
  const reduce = useReducedMotion()
  const absolute = absoluteTimeLabel(row.at)
  return (
    <AnimatePresence initial={false}>
      {open ? (
        <motion.div
          key="details"
          id={id}
          data-testid="paused-job-detail-panel"
          className="overflow-hidden"
          initial={reduce ? false : { height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
          transition={{ duration: reduce ? 0 : 0.18, ease: 'easeOut' }}
        >
          <div className="grid gap-3 pt-2 pb-1 sm:pl-6">
            <dl className="grid gap-2 text-callout text-text-secondary">
              {row.kind === 'storage' ? (
                <DetailItem label={m.agency_paused_detail_storage_key()}>
                  <span className="font-mono break-words text-text-primary select-all">
                    <StorageKey value={row.storageKey ?? row.id} />
                  </span>
                </DetailItem>
              ) : (
                <>
                  <DetailItem label={m.agency_paused_detail_client()}>
                    {row.organizationName}
                  </DetailItem>
                  <DetailItem label={m.agency_paused_detail_site()}>
                    {row.siteName}
                  </DetailItem>
                </>
              )}
              <DetailItem
                label={
                  row.kind === 'storage'
                    ? m.agency_paused_detail_queued()
                    : m.agency_paused_detail_last_attempt()
                }
              >
                <time dateTime={new Date(row.at).toISOString()}>
                  {absolute}
                </time>
              </DetailItem>
            </dl>
            {row.lastError ? (
              <div className="grid gap-1">
                <p className="text-caption text-text-secondary">
                  {m.agency_paused_last_error()}
                </p>
                <p className="font-mono text-caption leading-5 break-words whitespace-pre-wrap text-text-secondary select-text">
                  {row.lastError}
                </p>
              </div>
            ) : null}
            <div>
              <Button
                type="button"
                variant="quiet"
                size="sm"
                data-testid="paused-job-dismiss"
                disabled={busy}
                className="-ml-2"
                onClick={onDismiss}
              >
                {m.agency_paused_dismiss()}
              </Button>
            </div>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}

/** A storage key with a break point after each slash, so it wraps between folders. */
function StorageKey({ value }: { value: string }) {
  return value.split('/').map((part, index) => (
    <React.Fragment key={index}>
      {index > 0 ? '/' : null}
      {index > 0 ? <wbr /> : null}
      {part}
    </React.Fragment>
  ))
}

function DetailItem({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="grid gap-0.5 sm:grid-cols-[7rem_minmax(0,1fr)] sm:gap-3">
      <dt className="text-text-secondary">{label}</dt>
      <dd className="min-w-0 text-text-primary">{children}</dd>
    </div>
  )
}
