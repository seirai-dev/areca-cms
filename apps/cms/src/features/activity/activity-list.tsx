import * as React from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import { Scroll } from '@phosphor-icons/react'

import { formatAuditAction, formatAuditTarget } from '#/components/admin/helpers'
import { SystemAvatar, UserAvatar } from '#/components/ui/avatar'
import { Button } from '#/components/ui/button'
import { EmptyState } from '#/components/ui/empty-state'
import { QueryError } from '#/components/ui/query-error'
import { Skeleton } from '#/components/ui/skeleton'
import { RelativeTime, Timeline, TimelineItem } from '#/components/ui/timeline'
import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'
import { getLocale } from '#/paraglide/runtime'
import { listAuditLogFn } from '#/server/fn/admin'

export type ActivityRow = Awaited<ReturnType<typeof listAuditLogFn>>[number]

export const activityQueryKey = (organizationId?: string, siteId?: string) =>
  ['activity', organizationId ?? 'all', siteId ?? 'all'] as const

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

/** "Today", "Yesterday", then a date (brief §3.7). */
export function dayLabel(value: Date | string, now = new Date()) {
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
export function activitySentence(row: ActivityRow) {
  const action = formatAuditAction(row.action)
  const rawTarget = formatAuditTarget({
    targetType: row.targetType,
    targetId: row.targetId,
    organizationName: row.organizationName,
    siteName: row.siteName,
    meta: row.meta,
  })
  // Action labels already name the thing ("Published entry"), so only add
  // the target when it says something more.
  const namesType = action.toLowerCase().includes(row.targetType)
  const target = namesType
    ? rawTarget === row.targetType
      ? ''
      : rawTarget.replace(new RegExp(`^${row.targetType} `), '')
    : rawTarget
  return { action, target }
}

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
  className,
}: {
  organizationId?: string
  siteId?: string
  pageSize?: number
  /** Show the client / site each event happened in. */
  showScope?: boolean
  className?: string
}) {
  const listAuditLog = useServerFn(listAuditLogFn)
  const query = useInfiniteQuery({
    queryKey: [...activityQueryKey(organizationId, siteId), pageSize],
    initialPageParam: 0,
    // One extra row tells us whether there is another page.
    queryFn: ({ pageParam }) =>
      listAuditLog({
        data: { organizationId, siteId, limit: pageSize + 1, offset: pageParam },
      }),
    getNextPageParam: (lastPage, pages) =>
      lastPage.length > pageSize ? pages.length * pageSize : undefined,
  })

  const rows = React.useMemo(
    () => (query.data?.pages ?? []).flatMap((page) => page.slice(0, pageSize)),
    [query.data, pageSize],
  )

  const groups = React.useMemo(() => {
    const out: Array<{ day: string; rows: ActivityRow[] }> = []
    for (const row of rows) {
      const day = dayLabel(row.createdAt)
      const last = out.at(-1)
      if (last && last.day === day) last.rows.push(row)
      else out.push({ day, rows: [row] })
    }
    return out
  }, [rows])

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
          <h3 className="text-overline text-text-muted">{group.day}</h3>
          <Timeline>
            {group.rows.map((row) => {
              const { action, target } = activitySentence(row)
              const scope = [row.organizationName, row.siteName]
                .filter(Boolean)
                .join(' · ')
              return (
                <TimelineItem
                  key={row.id}
                  data-testid="activity-item"
                  data-action={row.action}
                  tone="plain"
                  icon={
                    row.actorName ? (
                      <UserAvatar name={row.actorName} size="md" className="size-7 text-[10.5px]" />
                    ) : (
                      <SystemAvatar size="md" className="size-7" label={m.activity_system()} />
                    )
                  }
                  title={
                    <span>
                      <span className="text-text-primary">
                        {row.actorName ?? m.activity_system()}
                      </span>{' '}
                      <span className="font-normal text-text-secondary">
                        {action.charAt(0).toLocaleLowerCase(getLocale()) + action.slice(1)}
                      </span>
                      {target ? (
                        <>
                          {' '}
                          <span className="text-text-primary">{target}</span>
                        </>
                      ) : null}
                    </span>
                  }
                  time={<RelativeTime value={row.createdAt} />}
                  meta={
                    showScope && scope ? (
                      <span className="text-caption font-normal text-text-muted">{scope}</span>
                    ) : undefined
                  }
                />
              )
            })}
          </Timeline>
        </section>
      ))}
      {query.hasNextPage ? (
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
