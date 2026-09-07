import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'

import { queryKeys } from '#/components/editor/query-keys'
import { EntryStatusBadge } from '#/components/editor/status-badge'
import {
  ENTRY_STATUSES,
  entryTitle,
  formatDateTime,
} from '#/components/editor/utils'
import { EmptyState } from '#/components/empty-state'
import { PageHeader } from '#/components/page-header'
import { createDataColumns, DataTable } from '#/components/data-table'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import { Skeleton } from '#/components/ui/skeleton'
import type { EntryData, EntryStatus, Field } from '#/lib/types'
import { listCollectionsFn, listEntriesFn } from '#/server/fn/content'

export const Route = createFileRoute('/_app/sites/$siteId/c/$collectionKey/')({
  component: EntriesPage,
})

type EntryRow = {
  id: string
  slug: string
  status: EntryStatus
  draftData: EntryData
  updatedAt: string | Date
  scheduledAt: string | Date | null
}

const EMPTY_ENTRIES: EntryRow[] = []

function EntriesPage() {
  const { siteId, collectionKey } = Route.useParams()
  const [status, setStatus] = useState<string>('all')
  const [search, setSearch] = useState('')

  const collectionsQuery = useQuery({
    queryKey: queryKeys.collections(siteId),
    queryFn: () => listCollectionsFn({ data: { siteId } }),
  })

  const collection = collectionsQuery.data?.find((item) => item.key === collectionKey)
  const fields = (collection?.fields ?? []) as Field[]

  const entriesQuery = useQuery({
    queryKey: queryKeys.entries(siteId, collectionKey, { status, search }),
    queryFn: () =>
      listEntriesFn({
        data: {
          siteId,
          collectionKey,
          status: status === 'all' ? undefined : (status as EntryStatus),
          search: search || undefined,
          limit: 100,
          offset: 0,
        },
      }),
  })

  const helper = createDataColumns<EntryRow>()
  const columns = useMemo(
    () =>
      helper.columns([
        helper.accessor((row) => entryTitle(row.draftData ?? {}, fields, row.slug), {
          id: 'title',
          header: 'Title',
          cell: ({ row }) => (
            <Link
              to="/sites/$siteId/c/$collectionKey/$entryId"
              params={{ siteId, collectionKey, entryId: row.original.id }}
              className="font-medium hover:underline"
            >
              {entryTitle(row.original.draftData ?? {}, fields, row.original.slug)}
            </Link>
          ),
        }),
        helper.accessor('slug', { header: 'Slug' }),
        helper.accessor('status', {
          header: 'Status',
          cell: ({ row }) => <EntryStatusBadge status={row.original.status} />,
        }),
        helper.accessor('updatedAt', {
          header: 'Updated',
          cell: ({ row }) => formatDateTime(row.original.updatedAt),
        }),
        helper.accessor('scheduledAt', {
          header: 'Scheduled',
          cell: ({ row }) => formatDateTime(row.original.scheduledAt),
        }),
      ]),
    [collectionKey, fields, helper, siteId],
  )

  const rows = (entriesQuery.data?.items ?? EMPTY_ENTRIES) as EntryRow[]

  if (collectionsQuery.isLoading) {
    return <Skeleton className="h-64 w-full" />
  }

  if (!collection) {
    return (
      <EmptyState
        title="Collection not found"
        description="This collection is missing or disabled."
      />
    )
  }

  return (
    <div className="grid gap-4">
      <PageHeader
        title={collection.label}
        description={`${entriesQuery.data?.total ?? 0} entries`}
        actions={
          <Button asChild data-testid="new-entry">
            <Link
              to="/sites/$siteId/c/$collectionKey/new"
              params={{ siteId, collectionKey }}
            >
              New entry
            </Link>
          </Button>
        }
      />
      <div className="flex flex-wrap gap-2">
        <Input
          placeholder="Search…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="max-w-xs"
        />
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {ENTRY_STATUSES.map((item) => (
              <SelectItem key={item} value={item}>
                {item}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {entriesQuery.isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No entries"
          description="Create a draft to get started."
          action={
            <Button asChild>
              <Link
                to="/sites/$siteId/c/$collectionKey/new"
                params={{ siteId, collectionKey }}
              >
                New entry
              </Link>
            </Button>
          }
        />
      ) : (
        <DataTable columns={columns} data={rows} />
      )}
    </div>
  )
}
