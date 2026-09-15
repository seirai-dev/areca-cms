import { useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import { ScrollText } from 'lucide-react'

import {
  adminQueryKeys,
  formatAuditAction,
  formatAuditTarget,
  formatDate,
} from '#/components/admin/helpers'
import { TableSkeleton } from '#/components/admin/table-skeleton'
import { createDataColumns, DataTable } from '#/components/data-table'
import { EmptyState } from '#/components/empty-state'
import { ListPagination } from '#/components/list-pagination'
import { QueryError } from '#/components/query-error'
import { listAuditLogFn } from '#/server/fn/admin'

const PAGE_SIZE = 25

type AuditRow = Awaited<ReturnType<typeof listAuditLogFn>>[number]

const relativeFormatter = new Intl.RelativeTimeFormat('en', {
  numeric: 'auto',
})

/**
 * "5 minutes ago" for anything in the last day, otherwise the full date.
 * The full timestamp is always available via the cell's `title`.
 */
function formatRelative(value: Date | string) {
  const date = typeof value === 'string' ? new Date(value) : value
  const diffMs = date.getTime() - Date.now()
  if (Number.isNaN(diffMs)) {
    return formatDate(value)
  }
  const abs = Math.abs(diffMs)
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour
  if (abs < minute) {
    return 'just now'
  }
  if (abs < hour) {
    return relativeFormatter.format(Math.round(diffMs / minute), 'minute')
  }
  if (abs < day) {
    return relativeFormatter.format(Math.round(diffMs / hour), 'hour')
  }
  return formatDate(value)
}

const helper = createDataColumns<AuditRow>()

const columns = helper.columns([
  helper.accessor('createdAt', {
    header: 'Time',
    sortFn: 'datetime',
    cell: ({ row }) => (
      <span
        className="whitespace-nowrap"
        title={formatDate(row.original.createdAt)}
      >
        {formatRelative(row.original.createdAt)}
      </span>
    ),
  }),
  helper.accessor('actorName', {
    header: 'Actor',
    cell: ({ row }) => row.original.actorName ?? 'System',
  }),
  helper.accessor('action', {
    header: 'Action',
    cell: ({ row }) => formatAuditAction(row.original.action),
  }),
  helper.display({
    id: 'target',
    header: 'Target',
    enableSorting: false,
    cell: ({ row }) =>
      formatAuditTarget({
        targetType: row.original.targetType,
        targetId: row.original.targetId,
        organizationName: row.original.organizationName,
        siteName: row.original.siteName,
        meta: row.original.meta,
      }),
  }),
  helper.display({
    id: 'scope',
    header: 'Org / site',
    enableSorting: false,
    cell: ({ row }) => (
      <span className="text-muted-foreground">
        {[row.original.organizationName, row.original.siteName]
          .filter(Boolean)
          .join(' / ') || '—'}
      </span>
    ),
  }),
])

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
        title="Could not load the audit log"
        error={query.error}
        onRetry={() => void query.refetch()}
        retrying={query.isFetching}
      />
    )
  }

  if (query.isPending) {
    return <TableSkeleton rows={8} columns={5} />
  }

  const hasMore = query.data.length > PAGE_SIZE
  const rows = hasMore ? query.data.slice(0, PAGE_SIZE) : query.data

  if (rows.length === 0 && offset === 0) {
    return (
      <EmptyState
        icon={<ScrollText />}
        title="No activity yet"
        description="Actions like creating sites, inviting members, and publishing entries will show up here."
      />
    )
  }

  return (
    <div
      className="grid gap-4"
      data-testid="audit-log"
      aria-busy={query.isFetching ? 'true' : undefined}
    >
      <div
        className={
          query.isFetching ? 'opacity-60 transition-opacity' : undefined
        }
      >
        <DataTable
          columns={columns}
          data={rows}
          emptyMessage="No events on this page."
          caption="Audit log"
        />
      </div>
      <ListPagination
        offset={offset}
        limit={PAGE_SIZE}
        count={rows.length}
        hasMore={hasMore}
        isFetching={query.isFetching}
        onChange={setOffset}
        noun="events"
      />
    </div>
  )
}
