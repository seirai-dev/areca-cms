import { useState } from 'react'
import type * as React from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { toast } from 'sonner'

import { errorMessage } from '#/components/admin/helpers'
import { ConfirmDialog } from '#/components/ui/confirm-dialog'
import { EntryThumb } from '#/components/editor/entry-thumb'
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
import { EmptyState } from '#/components/ui/empty-state'
import { ListPagination } from '#/components/list-pagination'
import { QueryError } from '#/components/ui/query-error'
import { RelativeTime } from '#/components/ui/timeline'
import { Avatar, AvatarFallback } from '#/components/ui/avatar'
import { Button } from '#/components/ui/button'
import { Checkbox } from '#/components/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { Input } from '#/components/ui/input'
import { Skeleton } from '#/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '#/components/ui/tabs'
import { useDebouncedValue } from '#/hooks/use-debounced-value'
import type { EntryData, EntryStatus, Field } from '#/lib/types'
import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'
import {
  deleteEntryFn,
  listEntriesFn,
  publishEntryFn,
  unpublishEntryFn,
} from '#/server/fn/content'
import {
  ArrowSquareOut,
  DotsThree,
  EyeSlash,
  FileText,
  PaperPlaneTilt,
  PencilSimple,
  Plus,
  Trash,
} from '@phosphor-icons/react'

type EntryRow = {
  id: string
  slug: string
  status: EntryStatus
  draftData: EntryData
  updatedAt: string | Date
  scheduledAt: string | Date | null
  updatedByName?: string | null
}

export type PaneCollection = {
  key: string
  label: string
  routePattern: string
  enabled: boolean
  fields: Field[]
}

const PAGE_SIZE = 25
const EMPTY_ENTRIES: EntryRow[] = []

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('')
}

/**
 * Right pane of the Content screen: the collection header, the status filter,
 * search, and the entries table with its bulk bar.
 */
export function EntriesPane({
  siteId,
  collection,
  canManage,
  headerActions,
}: {
  siteId: string
  collection: PaneCollection
  canManage: boolean
  /** Extra header controls before "New entry" (the admin ⋯ menu). */
  headerActions?: React.ReactNode
}) {
  const collectionKey = collection.key
  const fields = collection.fields
  const queryClient = useQueryClient()
  const reduceMotion = useReducedMotion()
  const [status, setStatus] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [offset, setOffset] = useState(0)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkDelete, setBulkDelete] = useState(false)
  const debouncedSearch = useDebouncedValue(search.trim())
  const imageField = fields.find((field) => field.type === 'image')

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

  const rows: EntryRow[] = entriesQuery.data?.items ?? EMPTY_ENTRIES
  const total = entriesQuery.data?.total
  const filtersActive = status !== 'all' || search !== ''
  const selectedRows = rows.filter((row) => selected.has(row.id))
  const allSelected = rows.length > 0 && selectedRows.length === rows.length

  async function invalidate() {
    await queryClient.invalidateQueries({
      queryKey: ['entries', siteId, collectionKey],
    })
  }

  const bulkMutation = useMutation({
    mutationFn: async (input: {
      action: 'publish' | 'unpublish' | 'delete'
      ids: string[]
    }) => {
      const fn =
        input.action === 'publish'
          ? publishEntryFn
          : input.action === 'unpublish'
            ? unpublishEntryFn
            : deleteEntryFn
      let failed = 0
      for (const id of input.ids) {
        try {
          await fn({ data: { id } })
        } catch {
          failed += 1
        }
      }
      return { done: input.ids.length - failed, failed }
    },
    onSuccess: async (result, input) => {
      setSelected(new Set())
      if (result.failed > 0) {
        toast.warning(
          m.editor_bulk_partial({ done: result.done, failed: result.failed }),
        )
      } else {
        toast.success(
          input.action === 'publish'
            ? m.editor_bulk_published({ count: result.done })
            : input.action === 'unpublish'
              ? m.editor_bulk_unpublished({ count: result.done })
              : m.editor_bulk_deleted({ count: result.done }),
        )
      }
      await invalidate()
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  function clearFilters() {
    setStatus('all')
    setSearch('')
    setOffset(0)
  }

  /** The header button carries `new-entry`; the empty state repeats it. */
  function newEntryButton(testId?: string) {
    if (!collection.enabled) return null
    return (
      <Button asChild data-testid={testId}>
        <Link
          to="/sites/$siteId/c/$collectionKey/new"
          params={{ siteId, collectionKey }}
        >
          <Plus />
          {m.editor_new_entry()}
        </Link>
      </Button>
    )
  }

  return (
    <div className="relative flex min-w-0 flex-col gap-4">
      <div className="mb-2 flex flex-wrap items-end justify-between gap-3">
        <div className="grid min-w-0 gap-1">
          <h1 className="truncate text-display text-text-primary">
            {collection.label}
          </h1>
          <p className="truncate text-caption font-normal text-text-muted">
            {total !== undefined ? (
              <span className="tnum">
                {total === 1
                  ? m.collection_entry_count_one({ count: total })
                  : m.collection_entry_count_other({ count: total })}
                {' · '}
              </span>
            ) : null}
            <span className="font-mono">{collection.routePattern}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          {headerActions}
          {newEntryButton('new-entry')}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Tabs
          value={status}
          className="max-w-full overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          onValueChange={(value) => {
            setStatus(value)
            setOffset(0)
          }}
        >
          <TabsList variant="segmented">
            <TabsTrigger value="all">{m.editor_all_statuses()}</TabsTrigger>
            {ENTRY_STATUSES.map((item) => (
              <TabsTrigger key={item} value={item}>
                {entryStatusLabel(item)}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <Input
          type="search"
          aria-label={m.editor_search_entries()}
          placeholder={m.editor_search_entries_placeholder()}
          value={search}
          onChange={(event) => {
            setSearch(event.target.value)
            setOffset(0)
          }}
          className="w-full sm:ml-auto sm:max-w-56"
        />
      </div>

      {entriesQuery.isError ? (
        <QueryError
          title={m.editor_could_not_load_entries()}
          error={entriesQuery.error}
          onRetry={() => entriesQuery.refetch()}
          retrying={entriesQuery.isFetching}
        />
      ) : entriesQuery.isLoading ? (
        <div className="grid gap-2">
          {Array.from({ length: 5 }, (_, index) => (
            <Skeleton key={index} className="h-11 w-full" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        filtersActive ? (
          <EmptyState
            icon={<FileText weight="duotone" />}
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
            icon={<FileText weight="duotone" />}
            title={m.editor_no_entries_yet()}
            description={m.editor_no_entries_yet_description()}
            action={newEntryButton()}
          />
        )
      ) : (
        <div
          className="grid gap-4"
          aria-busy={entriesQuery.isFetching}
          style={{ opacity: entriesQuery.isFetching ? 0.7 : 1 }}
        >
          <Table>
            <caption className="sr-only">
              {m.editor_entries_caption({ name: collection.label })}
            </caption>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                {canManage ? (
                  <TableHead className="w-10">
                    <Checkbox
                      checked={allSelected}
                      aria-label={m.editor_select_all()}
                      onCheckedChange={(value) =>
                        setSelected(
                          value === true
                            ? new Set(rows.map((row) => row.id))
                            : new Set(),
                        )
                      }
                    />
                  </TableHead>
                ) : null}
                <TableHead>{m.editor_title()}</TableHead>
                <TableHead>{m.editor_status()}</TableHead>
                <TableHead className="hidden md:table-cell">
                  {m.editor_updated()}
                </TableHead>
                <TableHead className="hidden lg:table-cell">
                  {m.editor_author()}
                </TableHead>
                <TableHead>
                  <span className="sr-only">{m.editor_actions()}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const title = entryTitle(row.draftData, fields, row.slug)
                const cover = imageField
                  ? row.draftData[imageField.key]
                  : undefined
                const isSelected = selected.has(row.id)
                const author = row.updatedByName ?? m.sites_system()
                return (
                  <TableRow
                    key={row.id}
                    data-state={isSelected ? 'selected' : undefined}
                    className={cn(!collection.enabled && 'opacity-70')}
                  >
                    {canManage ? (
                      <TableCell>
                        <Checkbox
                          checked={isSelected}
                          aria-label={m.editor_select_entry({ title })}
                          onCheckedChange={() =>
                            setSelected((current) => {
                              const next = new Set(current)
                              if (next.has(row.id)) next.delete(row.id)
                              else next.add(row.id)
                              return next
                            })
                          }
                        />
                      </TableCell>
                    ) : null}
                    <TableCell className="max-w-[14rem] sm:max-w-md">
                      <div className="flex min-w-0 items-center gap-3 p-3">
                        <EntryThumb
                          assetId={
                            typeof cover === 'string' && cover
                              ? cover
                              : undefined
                          }
                        />
                        <div className="min-w-0">
                          <Link
                            to="/sites/$siteId/c/$collectionKey/$entryId"
                            params={{ siteId, collectionKey, entryId: row.id }}
                            className="block truncate text-ds-label-md text-text-primary hover:underline mb-1"
                          >
                            {title}
                          </Link>
                          <p className="truncate text-ds-mono-xs text-text-muted">
                            {row.slug}
                          </p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="grid gap-1">
                        <EntryStatusBadge status={row.status} />
                        {row.scheduledAt ? (
                          <span className="text-ds-body-xs text-text-muted">
                            {formatDateTime(row.scheduledAt)}
                          </span>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="hidden whitespace-nowrap text-text-muted md:table-cell">
                      <RelativeTime value={row.updatedAt} />
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      <div className="flex items-center gap-2 text-text-secondary">
                        <Avatar className="size-5 text-[10px]">
                          <AvatarFallback>{initials(author)}</AvatarFallback>
                        </Avatar>
                        <span className="truncate">{author}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              aria-label={m.editor_actions_for({ title })}
                            >
                              <DotsThree />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem asChild>
                              <Link
                                to="/sites/$siteId/c/$collectionKey/$entryId"
                                params={{
                                  siteId,
                                  collectionKey,
                                  entryId: row.id,
                                }}
                              >
                                <PencilSimple />
                                {m.editor_edit()}
                              </Link>
                            </DropdownMenuItem>
                            <DropdownMenuItem asChild>
                              <a
                                href={`/sites/${siteId}/c/${collectionKey}/${row.id}`}
                                target="_blank"
                                rel="noreferrer"
                              >
                                <ArrowSquareOut />
                                {m.editor_open_in_new_tab()}
                              </a>
                            </DropdownMenuItem>
                            {canManage ? (
                              <>
                                <DropdownMenuSeparator />
                                {row.status === 'published' ? (
                                  <DropdownMenuItem
                                    onSelect={() =>
                                      bulkMutation.mutate({
                                        action: 'unpublish',
                                        ids: [row.id],
                                      })
                                    }
                                  >
                                    <EyeSlash />
                                    {m.editor_unpublish()}
                                  </DropdownMenuItem>
                                ) : (
                                  <DropdownMenuItem
                                    onSelect={() =>
                                      bulkMutation.mutate({
                                        action: 'publish',
                                        ids: [row.id],
                                      })
                                    }
                                  >
                                    <PaperPlaneTilt />
                                    {m.editor_publish_now()}
                                  </DropdownMenuItem>
                                )}
                                <DropdownMenuItem
                                  variant="destructive"
                                  onSelect={() => {
                                    setSelected(new Set([row.id]))
                                    setBulkDelete(true)
                                  }}
                                >
                                  <Trash />
                                  {m.editor_delete_ellipsis()}
                                </DropdownMenuItem>
                              </>
                            ) : null}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
          <ListPagination
            offset={offset}
            limit={PAGE_SIZE}
            count={rows.length}
            total={total}
            onChange={setOffset}
            isFetching={entriesQuery.isFetching}
            noun={m.editor_entries()}
            nounSingular={m.editor_entry_noun()}
          />
        </div>
      )}

      <AnimatePresence>
        {canManage && selectedRows.length > 0 ? (
          <motion.div
            data-testid="bulk-actions"
            initial={reduceMotion ? false : { y: 24, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { y: 24, opacity: 0 }}
            transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
            className="sticky bottom-4 z-navbar flex flex-wrap items-center gap-2 rounded-surface border border-border-default bg-background-surface px-3 py-2 shadow-lg"
          >
            <p className="text-ds-label-md text-text-primary">
              {m.editor_selected_count({ count: selectedRows.length })}
            </p>
            <div className="ml-auto flex flex-wrap items-center gap-1">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={bulkMutation.isPending}
                onClick={() =>
                  bulkMutation.mutate({
                    action: 'publish',
                    ids: selectedRows.map((row) => row.id),
                  })
                }
              >
                <PaperPlaneTilt />
                {m.editor_publish()}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={bulkMutation.isPending}
                onClick={() =>
                  bulkMutation.mutate({
                    action: 'unpublish',
                    ids: selectedRows
                      .filter((row) => row.status === 'published')
                      .map((row) => row.id),
                  })
                }
              >
                <EyeSlash />
                {m.editor_unpublish()}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="text-text-error hover:text-text-error"
                disabled={bulkMutation.isPending}
                onClick={() => setBulkDelete(true)}
              >
                <Trash />
                {m.editor_delete()}
              </Button>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <ConfirmDialog
        open={bulkDelete}
        onOpenChange={setBulkDelete}
        title={m.editor_delete_entries_title({ count: selectedRows.length })}
        description={m.editor_delete_entries_description()}
        confirmLabel={m.editor_delete()}
        variant="destructive"
        onConfirm={async () => {
          await bulkMutation.mutateAsync({
            action: 'delete',
            ids: selectedRows.map((row) => row.id),
          })
        }}
      />
    </div>
  )
}
