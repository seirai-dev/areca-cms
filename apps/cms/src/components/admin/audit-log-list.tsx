import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'

import { adminQueryKeys, formatDate } from '#/components/admin/helpers'
import { TableSkeleton } from '#/components/admin/table-skeleton'
import { EmptyState } from '#/components/empty-state'
import { Button } from '#/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
import { listAuditLogFn } from '#/server/fn/admin'

const PAGE_SIZE = 25

export function AuditLogList({ organizationId }: { organizationId?: string }) {
  const listAuditLog = useServerFn(listAuditLogFn)
  const [offset, setOffset] = useState(0)
  const [rows, setRows] = useState<
    Awaited<ReturnType<typeof listAuditLogFn>> | null
  >(null)

  const query = useQuery({
    queryKey: adminQueryKeys.audit(offset, organizationId),
    queryFn: () =>
      listAuditLog({
        data: { limit: PAGE_SIZE, offset, organizationId },
      }),
  })

  useEffect(() => {
    if (!query.data) {
      return
    }
    setRows((current) => {
      if (offset === 0 || current === null) {
        return query.data
      }
      const seen = new Set(current.map((row) => row.id))
      return [...current, ...query.data.filter((row) => !seen.has(row.id))]
    })
  }, [offset, query.data])

  const hasMore = (query.data?.length ?? 0) === PAGE_SIZE

  if (rows === null && query.isLoading) {
    return <TableSkeleton rows={8} />
  }

  if (!rows?.length) {
    return <EmptyState title="No audit events" />
  }

  return (
    <div className="grid gap-4">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Time</TableHead>
            <TableHead>Actor</TableHead>
            <TableHead>Action</TableHead>
            <TableHead>Target</TableHead>
            <TableHead>Org / site</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell>{formatDate(row.createdAt)}</TableCell>
              <TableCell>{row.actorName ?? 'System'}</TableCell>
              <TableCell>{row.action}</TableCell>
              <TableCell>
                {row.targetType} {row.targetId}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {row.organizationId}
                {row.siteId ? ` / ${row.siteId}` : ''}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {hasMore ? (
        <Button
          type="button"
          variant="outline"
          className="justify-self-start"
          disabled={query.isFetching}
          onClick={() => setOffset((rows ?? []).length)}
        >
          {query.isFetching ? 'Loading…' : 'Load more'}
        </Button>
      ) : null}
    </div>
  )
}
