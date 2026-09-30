import * as React from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import { Scroll } from '@phosphor-icons/react'

import { Button } from '#/components/ui/button'
import { EmptyState } from '#/components/ui/empty-state'
import { QueryError } from '#/components/ui/query-error'
import { Skeleton } from '#/components/ui/skeleton'
import { Timeline } from '#/components/ui/timeline'
import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'
import { getLocale } from '#/paraglide/runtime'
import { listAuditLogFn } from '#/server/fn/admin'
import { ActivityTimelineItem, useActivityEntries } from './activity-item'
import { collapseRepeats } from './activity-sentence'
import type { ActivityGroup } from './activity-sentence'

export type ActivityRow = Awaited<ReturnType<typeof listAuditLogFn>>[number]

const activityQueryKey = (organizationId?: string, siteId?: string) =>
  ['activity', organizationId ?? 'all', siteId ?? 'all'] as const

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

/** "Today", "Yesterday", then a date (brief §3.7). */
function dayLabel(value: Date | string, now = new Date()) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const diff = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000)
  if (diff === 0) return m.activity_today()
  if (diff === 1) return m.activity_yesterday()
  return new Intl.DateTimeFormat(getLocale(), {
    weekday: diff < 7 ? 'long' : undefined,
    day: 'numeric',
    month: 'long',
    year: date.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  }).format(date)
}

/** The sentence for one event: action plus what it touched. */
/**
 * The activity timeline (brief §3.7): grouped by day, an avatar per actor (a
 * System glyph for actorless events), the action sentence, the target, the
 * scope and the time. "Show more" pages through the log. Used by the
 * Activity panel and the Agency activity page.
 *
 * `organizationId` + `siteId` narrow the log (owners must pass their
 * organization; only agency admins may omit it).
 */
export function ActivityList({
  organizationId,
  siteId,
  pageSize = 25,
  showScope = true,
  paged = true,
  grouped = true,
  className,
}: {
  organizationId?: string
  siteId?: string
  pageSize?: number
  /** Show the client / site each event happened in. */
  showScope?: boolean
  /** "Show more" paging; off for fixed previews (the Overview's last 5). */
  paged?: boolean
  /** Day headings ("Today", "Yesterday"). */
  grouped?: boolean
  className?: string
}) {
  const listAuditLog = useServerFn(listAuditLogFn)
  const query = useInfiniteQuery({
    queryKey: [...activityQueryKey(organizationId, siteId), pageSize],
    initialPageParam: 0,
    // One extra row tells us whether there is another page.
    queryFn: ({ pageParam }) =>
      listAuditLog({
        data: {
          organizationId,
          siteId,
          limit: pageSize + 1,
          offset: pageParam,
        },
      }),
    getNextPageParam: (lastPage, pages) =>
      lastPage.length > pageSize ? pages.length * pageSize : undefined,
  })

  const rows = React.useMemo(
    () => (query.data?.pages ?? []).flatMap((page) => page.slice(0, pageSize)),
    [query.data, pageSize],
  )

  const entries = useActivityEntries(rows)

  const groups = React.useMemo(() => {
    const out: Array<{
      day: string
      rows: Array<ActivityGroup<ActivityRow>>
    }> = []
    for (const group of collapseRepeats(rows)) {
      const day = dayLabel(group.row.createdAt)
      const last = out.at(-1)
      if (last && (!grouped || last.day === day)) last.rows.push(group)
      else out.push({ day, rows: [group] })
    }
    return out
  }, [rows, grouped])

  if (query.isError) {
    return (
      <QueryError
        title={m.activity_load_error()}
        error={query.error}
        onRetry={() => void query.refetch()}
        retrying={query.isFetching}
      />
    )
  }

  if (query.isPending) {
    return (
      <div className={cn('grid gap-5', className)} aria-busy="true">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="flex items-start gap-3">
            <Skeleton className="size-7 rounded-full" />
            <div className="grid flex-1 gap-2 pt-1">
              <Skeleton className="h-3.5 w-2/3" />
              <Skeleton className="h-3 w-1/3" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<Scroll weight="duotone" />}
        tone="neutral"
        size="sm"
        title={m.activity_empty_title()}
        description={m.activity_empty_description()}
      />
    )
  }

  return (
    <div
      className={cn('grid gap-6', className)}
      data-testid="audit-log"
      aria-busy={query.isFetching ? 'true' : undefined}
    >
      {groups.map((group) => (
        <section key={group.day} className="grid gap-3">
          {grouped ? (
            <h3 className="text-overline text-text-muted">{group.day}</h3>
          ) : null}
          <Timeline>
            {group.rows.map(({ row, count }) => (
              <ActivityTimelineItem
                key={row.id}
                row={row}
                count={count}
                entry={entries.get(row.targetId)}
                scope={
                  showScope
                    ? [row.organizationName, row.siteName]
                        .filter(Boolean)
                        .join(' · ')
                    : null
                }
              />
            ))}
          </Timeline>
        </section>
      ))}
      {paged && query.hasNextPage ? (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="justify-self-center"
          loading={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
          data-testid="activity-show-more"
        >
          {m.activity_show_more()}
        </Button>
      ) : null}
    </div>
  )
}
