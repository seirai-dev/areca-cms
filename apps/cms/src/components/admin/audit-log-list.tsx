import { useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import {
  adminQueryKeys,
  formatAuditAction,
  formatAuditTarget,
} from '#/components/admin/helpers'
import { EmptyState } from '#/components/ui/empty-state'
import { ListPagination } from '#/components/list-pagination'
import { QueryError } from '#/components/ui/query-error'
import { Avatar, AvatarFallback } from '#/components/ui/avatar'
import { Skeleton } from '#/components/ui/skeleton'
import { absoluteTimeLabel, formatRelativeTime } from '#/lib/relative-time'
import { m } from '#/paraglide/messages'
import { getLocale } from '#/paraglide/runtime'
import { listAuditLogFn } from '#/server/fn/admin'
import { Scroll } from '@phosphor-icons/react'

const PAGE_SIZE = 25

type AuditRow = Awaited<ReturnType<typeof listAuditLogFn>>[number]

function dayKey(value: Date | string) {
  const date = typeof value === 'string' ? new Date(value) : value
  return Number.isNaN(date.getTime())
    ? ''
    : new Intl.DateTimeFormat(getLocale(), { dateStyle: 'full' }).format(date)
}

function initials(name: string | null) {
  if (!name) return '·'
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join('') || '?'
  )
}

/**
 * Audit events as a timeline grouped by day. Each event shows who did what
 * to which target, and the scope it happened in.
 */
export function AuditLogList({ organizationId }: { organizationId?: string }) {
  const listAuditLog = useServerFn(listAuditLogFn)
  const [offset, setOffset] = useState(0)

  const query = useQuery({
    queryKey: adminQueryKeys.audit(offset, organizationId),
    // Ask for one extra row so we know whether a next page exists without a
    // separate count query.
    queryFn: () =>
      listAuditLog({
        data: { limit: PAGE_SIZE + 1, offset, organizationId },
      }),
    placeholderData: keepPreviousData,
  })

  if (query.isError) {
    return (
      <QueryError
        title={m.admin_audit_load_error()}
        error={query.error}
        onRetry={() => void query.refetch()}
        retrying={query.isFetching}
      />
    )
  }

  if (query.isPending) {
    return (
      <div className="grid gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    )
  }

  const hasMore = query.data.length > PAGE_SIZE
  const rows = hasMore ? query.data.slice(0, PAGE_SIZE) : query.data

  if (rows.length === 0 && offset === 0) {
    return (
      <EmptyState
        icon={<Scroll />}
        title={m.admin_audit_empty_title()}
        description={m.admin_audit_empty_description()}
      />
    )
  }

  const groups: Array<{ day: string; rows: AuditRow[] }> = []
  for (const row of rows) {
    const day = dayKey(row.createdAt)
    const last = groups.at(-1)
    if (last && last.day === day) last.rows.push(row)
    else groups.push({ day, rows: [row] })
  }

  return (
    <div
      className="grid gap-6"
      data-testid="audit-log"
      aria-busy={query.isFetching ? 'true' : undefined}
      style={{ opacity: query.isFetching ? 0.7 : 1 }}
    >
      {groups.map((group) => (
        <section key={group.day} className="grid gap-1">
          <h3 className="text-ds-label-md text-text-secondary">{group.day}</h3>
          <ol className="grid">
            {group.rows.map((row) => {
              const scope = [row.organizationName, row.siteName]
                .filter(Boolean)
                .join(' / ')
              const action = formatAuditAction(row.action)
              const rawTarget = formatAuditTarget({
                targetType: row.targetType,
                targetId: row.targetId,
                organizationName: row.organizationName,
                siteName: row.siteName,
                meta: row.meta,
              })
              // Action labels already name the thing ("Published entry"), so
              // only add the target when it says something more.
              const namesType = action.toLowerCase().includes(row.targetType)
              const target = namesType
                ? rawTarget === row.targetType
                  ? ''
                  : rawTarget.replace(new RegExp(`^${row.targetType} `), '')
                : rawTarget
              return (
                <li
                  key={row.id}
                  className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-b border-border-subtle py-2 last:border-b-0"
                >
                  <Avatar className="size-6">
                    <AvatarFallback className="text-ds-label-sm">
                      {initials(row.actorName)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 text-ds-body-sm">
                    <p className="truncate">
                      <span className="font-medium text-text-primary">
                        {row.actorName ?? m.admin_audit_system()}
                      </span>{' '}
                      <span className="text-text-secondary">{action}</span>{' '}
                      <span className="text-text-primary">{target}</span>
                    </p>
                    {scope ? (
                      <p className="truncate text-ds-body-xs text-text-muted">
                        {scope}
                      </p>
                    ) : null}
                  </div>
                  <time
                    className="text-ds-body-xs whitespace-nowrap text-text-muted"
                    title={absoluteTimeLabel(row.createdAt)}
                  >
                    {formatRelativeTime(row.createdAt)}
                  </time>
                </li>
              )
            })}
          </ol>
        </section>
      ))}
      <ListPagination
        offset={offset}
        limit={PAGE_SIZE}
        count={rows.length}
        hasMore={hasMore}
        isFetching={query.isFetching}
        onChange={setOffset}
        noun={m.admin_audit_events()}
        nounSingular={m.admin_audit_event_noun()}
      />
    </div>
  )
}
