import { useMemo, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import { ExternalLink, FileText, MoreHorizontal, Pencil, X } from 'lucide-react'

import { queryKeys } from '#/components/editor/query-keys'
import { EntryStatusBadge } from '#/components/editor/status-badge'
import {
  ENTRY_STATUSES,
  entryTitle,
  formatDateTime,
} from '#/components/editor/utils'
import { EmptyState } from '#/components/empty-state'
import { ListPagination } from '#/components/list-pagination'
import { PageHeader } from '#/components/page-header'
import { QueryError } from '#/components/query-error'
import { createDataColumns, DataTable } from '#/components/data-table'
import { Button } from '#/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { Input } from '#/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import { Skeleton } from '#/components/ui/skeleton'
import { useDebouncedValue } from '#/hooks/use-debounced-value'
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

const PAGE_SIZE = 25
const EMPTY_ENTRIES: EntryRow[] = []

const STATUS_LABELS: Record<EntryStatus, string> = {
  draft: 'Draft',
  published: 'Published',
  scheduled: 'Scheduled',
  archived: 'Archived',
}

function EntriesPage() {
  const { siteId, collectionKey } = Route.useParams()
  const [status, setStatus] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [offset, setOffset] = useState(0)
  const debouncedSearch = useDebouncedValue(search.trim())

  const collectionsQuery = useQuery({
    queryKey: queryKeys.collections(siteId),
    queryFn: () => listCollectionsFn({ data: { siteId } }),
  })

  const collection = collectionsQuery.data?.find(
    (item) => item.key === collectionKey,
  )
  const fields: Field[] = collection?.fields ?? []

  const entriesQuery = useQuery({
    queryKey: [
      ...queryKeys.entries(siteId, collectionKey, {
        status,
        search: debouncedSearch,
      }),
      offset,
    ],
    queryFn: () =>
      listEntriesFn({
        data: {
          siteId,
          collectionKey,
          status: status === 'all' ? undefined : (status as EntryStatus),
          search: debouncedSearch || undefined,
          limit: PAGE_SIZE,
          offset,
        },
      }),
    placeholderData: keepPreviousData,
  })

  const helper = createDataColumns<EntryRow>()
  const columns = useMemo(
    () =>
      helper.columns([
        helper.accessor((row) => entryTitle(row.draftData, fields, row.slug), {
          id: 'title',
          header: 'Title',
          cell: ({ row }) => (
            <Link
              to="/sites/$siteId/c/$collectionKey/$entryId"
              params={{ siteId, collectionKey, entryId: row.original.id }}
              className="text-link -m-2 block p-2 font-medium hover:underline"
            >
              {entryTitle(row.original.draftData, fields, row.original.slug)}
            </Link>
          ),
        }),
        helper.accessor('slug', {
          header: 'Slug',
          cell: ({ row }) => (
            <span className="font-mono text-xs text-muted-foreground">
              {row.original.slug}
            </span>
          ),
        }),
        helper.accessor('status', {
          header: 'Status',
          cell: ({ row }) => <EntryStatusBadge status={row.original.status} />,
        }),
        helper.accessor('updatedAt', {
          header: 'Updated',
          sortFn: 'datetime',
          cell: ({ row }) => (
            <span className="whitespace-nowrap text-muted-foreground">
              {formatDateTime(row.original.updatedAt)}
            </span>
          ),
        }),
        helper.accessor('scheduledAt', {
          header: 'Scheduled',
          sortFn: 'datetime',
          cell: ({ row }) => (
            <span className="whitespace-nowrap text-muted-foreground">
              {formatDateTime(row.original.scheduledAt)}
            </span>
          ),
        }),
        helper.display({
          id: 'actions',
          header: () => <span className="sr-only">Actions</span>,
          enableSorting: false,
          cell: ({ row }) => {
            const title = entryTitle(
              row.original.draftData,
              fields,
              row.original.slug,
            )
            return (
              <div className="flex justify-end">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Actions for ${title}`}
                    >
                      <MoreHorizontal />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem asChild>
                      <Link
                        to="/sites/$siteId/c/$collectionKey/$entryId"
                        params={{
                          siteId,
                          collectionKey,
                          entryId: row.original.id,
                        }}
                      >
                        <Pencil />
                        Edit
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <a
                        href={`/sites/${siteId}/c/${collectionKey}/${row.original.id}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <ExternalLink />
                        Open in new tab
                      </a>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )
          },
        }),
      ]),
    [collectionKey, fields, helper, siteId],
  )

  const rows: EntryRow[] = entriesQuery.data?.items ?? EMPTY_ENTRIES
  const total = entriesQuery.data?.total
  const filtersActive = status !== 'all' || search !== ''

  function clearFilters() {
    setStatus('all')
    setSearch('')
    setOffset(0)
  }

  if (collectionsQuery.isLoading) {
    return (
      <div className="grid gap-6">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  if (collectionsQuery.isError) {
    return (
      <QueryError
        title="Could not load collection"
        error={collectionsQuery.error}
        onRetry={() => collectionsQuery.refetch()}
        retrying={collectionsQuery.isFetching}
      />
    )
  }

  if (!collection) {
    return (
      <EmptyState
        icon={<FileText />}
        title="Collection not found"
        description="This collection is missing or disabled. Check the site settings."
        action={
          <Button asChild variant="outline">
            <Link to="/sites/$siteId" params={{ siteId }}>
              Back to site
            </Link>
          </Button>
        }
      />
    )
  }

  const newEntryLink = (
    <Link
      to="/sites/$siteId/c/$collectionKey/new"
      params={{ siteId, collectionKey }}
    >
      New entry
    </Link>
  )

  return (
    <div className="grid gap-6">
      <PageHeader
        title={collection.label}
        description={
          typeof total === 'number'
            ? `${total} ${total === 1 ? 'entry' : 'entries'}`
            : undefined
        }
        actions={
          <Button asChild data-testid="new-entry">
            {newEntryLink}
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="search"
          aria-label="Search entries"
          placeholder="Search entries…"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value)
            setOffset(0)
          }}
          className="w-full sm:max-w-xs"
        />
        <Select
          value={status}
          onValueChange={(value) => {
            setStatus(value)
            setOffset(0)
          }}
        >
          <SelectTrigger className="w-40" aria-label="Filter by status">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {ENTRY_STATUSES.map((item) => (
              <SelectItem key={item} value={item}>
                {STATUS_LABELS[item]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {filtersActive ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={clearFilters}
          >
            <X />
            Clear filters
          </Button>
        ) : null}
      </div>

      {entriesQuery.isError ? (
        <QueryError
          title="Could not load entries"
          error={entriesQuery.error}
          onRetry={() => entriesQuery.refetch()}
          retrying={entriesQuery.isFetching}
        />
      ) : entriesQuery.isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : rows.length === 0 ? (
        filtersActive ? (
          <EmptyState
            icon={<FileText />}
            title="No matching entries"
            description="Try a different search term or status."
            action={
              <Button type="button" variant="outline" onClick={clearFilters}>
                Clear filters
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={<FileText />}
            title="No entries yet"
            description="Create a draft to get started."
            action={<Button asChild>{newEntryLink}</Button>}
          />
        )
      ) : (
        <div
          className="grid gap-3"
          aria-busy={entriesQuery.isFetching}
          style={{ opacity: entriesQuery.isFetching ? 0.7 : 1 }}
        >
          <DataTable
            columns={columns}
            data={rows}
            caption={`${collection.label} entries`}
          />
          <ListPagination
            offset={offset}
            limit={PAGE_SIZE}
            count={rows.length}
            total={total}
            onChange={setOffset}
            isFetching={entriesQuery.isFetching}
            noun="entries"
          />
        </div>
      )}
    </div>
  )
}
