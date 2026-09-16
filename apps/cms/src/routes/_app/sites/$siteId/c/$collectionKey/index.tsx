import { useMemo, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import { ExternalLink, FileText, MoreHorizontal, Pencil, X } from 'lucide-react'

import { queryKeys } from '#/components/editor/query-keys'
import {
  EntryStatusBadge,
  entryStatusLabel,
} from '#/components/editor/status-badge'
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
import { m } from '#/paraglide/messages'
import { getLocale } from '#/paraglide/runtime'
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
          header: m.editor_title(),
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
          header: m.editor_slug(),
          cell: ({ row }) => (
            <span className="font-mono text-xs text-muted-foreground">
              {row.original.slug}
            </span>
          ),
        }),
        helper.accessor('status', {
          header: m.editor_status(),
          cell: ({ row }) => <EntryStatusBadge status={row.original.status} />,
        }),
        helper.accessor('updatedAt', {
          header: m.editor_updated(),
          sortFn: 'datetime',
          cell: ({ row }) => (
            <span className="whitespace-nowrap text-muted-foreground">
              {formatDateTime(row.original.updatedAt)}
            </span>
          ),
        }),
        helper.accessor('scheduledAt', {
          header: m.editor_status_scheduled(),
          sortFn: 'datetime',
          cell: ({ row }) => (
            <span className="whitespace-nowrap text-muted-foreground">
              {formatDateTime(row.original.scheduledAt)}
            </span>
          ),
        }),
        helper.display({
          id: 'actions',
          header: () => <span className="sr-only">{m.editor_actions()}</span>,
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
                      aria-label={m.editor_actions_for({ title })}
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
                        {m.editor_edit()}
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <a
                        href={`/sites/${siteId}/c/${collectionKey}/${row.original.id}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <ExternalLink />
                        {m.editor_open_in_new_tab()}
                      </a>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )
          },
        }),
      ]),
    [collectionKey, fields, helper, siteId, getLocale()],
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
        title={m.editor_could_not_load_collection()}
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
        title={m.editor_collection_not_found()}
        description={m.editor_collection_not_found_description()}
        action={
          <Button asChild variant="outline">
            <Link to="/sites/$siteId" params={{ siteId }}>
              {m.editor_back_to_site()}
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
      {m.editor_new_entry()}
    </Link>
  )

  return (
    <div className="grid gap-6">
      <PageHeader
        title={collection.label}
        description={
          typeof total === 'number'
            ? total === 1
              ? m.editor_one_entry({ count: total })
              : m.editor_n_entries({ count: total })
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
          aria-label={m.editor_search_entries()}
          placeholder={m.editor_search_entries_placeholder()}
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
          <SelectTrigger
            className="w-40"
            aria-label={m.editor_filter_by_status()}
          >
            <SelectValue placeholder={m.editor_status()} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{m.editor_all_statuses()}</SelectItem>
            {ENTRY_STATUSES.map((item) => (
              <SelectItem key={item} value={item}>
                {entryStatusLabel(item)}
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
            {m.editor_clear_filters()}
          </Button>
        ) : null}
      </div>

      {entriesQuery.isError ? (
        <QueryError
          title={m.editor_could_not_load_entries()}
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
            title={m.editor_no_matching_entries()}
            description={m.editor_no_matching_entries_description()}
            action={
              <Button type="button" variant="outline" onClick={clearFilters}>
                {m.editor_clear_filters()}
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={<FileText />}
            title={m.editor_no_entries_yet()}
            description={m.editor_no_entries_yet_description()}
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
            caption={m.editor_entries_caption({ name: collection.label })}
          />
          <ListPagination
            offset={offset}
            limit={PAGE_SIZE}
            count={rows.length}
            total={total}
            onChange={setOffset}
            isFetching={entriesQuery.isFetching}
            noun={m.editor_entries()}
          />
        </div>
      )}
    </div>
  )
}
