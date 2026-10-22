import { ArrowClockwise, PauseCircle, X } from '@phosphor-icons/react'

import { Button } from '#/components/ui/button'
import { EmptyState } from '#/components/ui/empty-state'
import { QueryError } from '#/components/ui/query-error'
import { SettingsSection } from '#/components/ui/settings-section'
import { Skeleton } from '#/components/ui/skeleton'
import { Tag } from '#/components/ui/tag'
import { m } from '#/paraglide/messages'

import { pausedRows } from './paused-jobs-logic'
import { usePausedJobAction, usePausedJobs } from './use-paused-jobs'

/**
 * Agency → Mail: work that stopped after four failed attempts. Retry starts a
 * new attempt cycle. Dismiss hides the item and deletes nothing.
 */
export function PausedJobsSection() {
  const query = usePausedJobs()
  const retry = usePausedJobAction('retry')
  const dismiss = usePausedJobAction('dismiss')
  const rows = pausedRows(query.data)

  return (
    <SettingsSection
      id="paused-jobs"
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
        <Skeleton className="h-16 rounded-control" />
      ) : rows.length === 0 ? (
        <EmptyState size="sm" tone="neutral" title={m.agency_paused_empty()} />
      ) : (
        <ul
          className="overflow-hidden surface-card"
          data-testid="paused-jobs-list"
        >
          {rows.map((row) => {
            const pending =
              (retry.isPending || dismiss.isPending) &&
              (retry.variables?.id === row.id ||
                dismiss.variables?.id === row.id)
            return (
              <li
                key={row.key}
                className="grid gap-3 border-b border-border-default px-4 py-3 last:border-b-0 md:grid-cols-[minmax(0,1fr)_auto] md:items-center md:gap-6"
                data-testid="paused-job-row"
                data-kind={row.kind}
              >
                <div className="grid min-w-0 gap-1">
                  <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                    <PauseCircle className="size-4 shrink-0 text-icon-muted" />
                    <span className="truncate text-[14px] leading-5 font-medium text-text-primary">
                      {row.kind === 'storage'
                        ? m.agency_paused_storage_title()
                        : m.agency_paused_schedule_title({
                            site: row.siteName ?? '',
                          })}
                    </span>
                    <Tag tone="warning">
                      {m.agency_paused_attempts({
                        count: String(row.attempts),
                      })}
                    </Tag>
                  </div>
                  <span className="text-caption text-text-secondary">
                    {row.kind === 'storage'
                      ? m.agency_paused_storage_reason()
                      : `${row.organizationName ?? ''} · ${m.agency_paused_schedule_reason()}`}
                  </span>
                  {row.lastError ? (
                    <details className="text-caption text-text-muted">
                      <summary className="cursor-pointer">
                        {m.agency_paused_details()}
                      </summary>
                      <p className="mt-1 font-mono break-all whitespace-pre-wrap">
                        {m.agency_paused_last_error()}: {row.lastError}
                      </p>
                    </details>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    data-testid="paused-job-retry"
                    disabled={pending}
                    onClick={() => retry.mutate({ kind: row.kind, id: row.id })}
                  >
                    <ArrowClockwise />
                    {m.agency_paused_retry()}
                  </Button>
                  <Button
                    type="button"
                    variant="quiet"
                    size="sm"
                    data-testid="paused-job-dismiss"
                    disabled={pending}
                    onClick={() =>
                      dismiss.mutate({ kind: row.kind, id: row.id })
                    }
                  >
                    <X />
                    {m.agency_paused_dismiss()}
                  </Button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </SettingsSection>
  )
}
