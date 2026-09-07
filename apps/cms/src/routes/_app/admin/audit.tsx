import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'

import {
  adminQueryKeys,
  formatDate,
} from '#/components/admin/helpers'
import { TableSkeleton } from '#/components/admin/table-skeleton'
import { EmptyState } from '#/components/empty-state'
import { PageHeader } from '#/components/page-header'
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

export const Route = createFileRoute('/_app/admin/audit')({
  component: AuditPage,
})

function AuditPage() {
  const listAuditLog = useServerFn(listAuditLogFn)
  const [offset, setOffset] = useState(0)
  const [rows, setRows] = useState<
    Awaited<ReturnType<typeof listAuditLogFn>> | null
  >(null)

  const query = useQuery({
    queryKey: adminQueryKeys.audit(offset),
    queryFn: () => listAuditLog({ data: { limit: PAGE_SIZE, offset } }),
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

  return (
    <div className="grid gap-6">
      <PageHeader title="Audit log" description="Recent agency actions." />
      {rows === null && query.isLoading ? (
        <TableSkeleton rows={8} />
      ) : rows?.length ? (
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
      ) : (
        <EmptyState title="No audit events" />
      )}
    </div>
  )
}
