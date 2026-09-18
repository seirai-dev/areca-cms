import { useState } from 'react'
import type { ReactNode } from 'react'
import {
  createColumnHelper,
  createPaginatedRowModel,
  createSortedRowModel,
  rowPaginationFeature,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_basic,
  sortFn_datetime,
  sortFn_text,
  tableFeatures,
  useTable,
} from '@tanstack/react-table'
import type {
  ColumnDef,
  PaginationState,
  RowData,
  SortingState,
} from '@tanstack/react-table'
import { Button } from '#/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'
import { ArrowDown, ArrowUp, ArrowsDownUp } from '@phosphor-icons/react'

const dataTableFeatures = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: {
    alphanumeric: sortFn_alphanumeric,
    basic: sortFn_basic,
    datetime: sortFn_datetime,
    text: sortFn_text,
  },
  rowPaginationFeature,
  paginatedRowModel: createPaginatedRowModel(),
})

export type DataTableFeatures = typeof dataTableFeatures

export const createDataColumns = <TData extends RowData>() =>
  createColumnHelper<DataTableFeatures, TData>()

/**
 * Columns may carry `meta.className` (for example `hidden md:table-cell`) so a
 * table can drop its low-priority columns on narrow screens instead of
 * scrolling sideways.
 */
function columnClassName(column: { columnDef: { meta?: unknown } }) {
  const meta = column.columnDef.meta
  return meta &&
    typeof meta === 'object' &&
    'className' in meta &&
    typeof meta.className === 'string'
    ? meta.className
    : undefined
}

/**
 * Shared table renderer.
 *
 * - Columns are sortable by clicking the header (client-side). Opt a column
 *   out with `enableSorting: false` (e.g. action columns).
 * - Pass `pageSize` to paginate client-side; the pager only renders when the
 *   data exceeds one page. Server-paged lists should leave `pageSize` unset and
 *   render `ListPagination` themselves.
 * - The table container scrolls horizontally on narrow screens so wide tables
 *   never clip on mobile.
 */
export function DataTable<TData extends RowData>({
  columns,
  data,
  emptyMessage = m.shared_no_results(),
  pageSize,
  initialSorting = [],
  getRowProps,
  caption,
  density = 'default',
}: {
  columns: Array<ColumnDef<DataTableFeatures, TData>>
  data: Array<TData>
  emptyMessage?: ReactNode
  pageSize?: number
  initialSorting?: SortingState
  getRowProps?: (row: TData) => React.ComponentProps<typeof TableRow>
  caption?: ReactNode
  /** `compact` drops the row height from 44px to 36px. */
  density?: 'default' | 'compact'
}) {
  const [sorting, setSorting] = useState<SortingState>(initialSorting)
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: pageSize ?? Number.MAX_SAFE_INTEGER,
  })

  const table = useTable({
    features: dataTableFeatures,
    columns,
    data,
    state: { sorting, pagination },
    onSortingChange: setSorting,
    onPaginationChange: setPagination,
    enableSortingRemoval: false,
    autoResetPageIndex: true,
  })

  const rows = table.getRowModel().rows
  const pageCount = table.getPageCount()
  const showPager = Boolean(pageSize) && pageCount > 1

  return (
    <div className="grid min-w-0 gap-3">
      <div
        data-density={density}
        className="group/data-table max-w-full overflow-x-auto"
      >
        <Table>
          {caption ? <caption className="sr-only">{caption}</caption> : null}
          <TableHeader>
            {table.getHeaderGroups().map((group) => (
              <TableRow
                key={group.id}
                className="border-b border-border-strong hover:bg-transparent"
              >
                {group.headers.map((header) => {
                  const canSort = header.column.getCanSort()
                  const sorted = header.column.getIsSorted()
                  return (
                    <TableHead
                      key={header.id}
                      className={columnClassName(header.column)}
                      aria-sort={
                        sorted === 'asc'
                          ? 'ascending'
                          : sorted === 'desc'
                            ? 'descending'
                            : undefined
                      }
                    >
                      {header.isPlaceholder ? null : canSort ? (
                        <button
                          type="button"
                          className={cn(
                            '-ml-2 inline-flex h-8 items-center gap-1 rounded-control px-2 text-left hover:text-text-primary',
                            sorted && 'text-text-primary',
                          )}
                          onClick={header.column.getToggleSortingHandler()}
                        >
                          <table.FlexRender header={header} />
                          {sorted === 'asc' ? (
                            <ArrowUp className="size-3.5" />
                          ) : sorted === 'desc' ? (
                            <ArrowDown className="size-3.5" />
                          ) : (
                            <ArrowsDownUp className="size-3.5 opacity-40" />
                          )}
                        </button>
                      ) : (
                        <table.FlexRender header={header} />
                      )}
                    </TableHead>
                  )
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {rows.length ? (
              rows.map((row) => (
                <TableRow key={row.id} {...getRowProps?.(row.original)}>
                  {row.getAllCells().map((cell) => (
                    <TableCell
                      key={cell.id}
                      className={cn(
                        density === 'compact' && 'h-9',
                        columnClassName(cell.column),
                      )}
                    >
                      <table.FlexRender cell={cell} />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow className="hover:bg-transparent">
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center text-text-muted"
                >
                  {emptyMessage}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      {showPager ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-ds-body-sm text-text-muted">
            {m.shared_page_of({
              page: pagination.pageIndex + 1,
              pageCount,
              count: data.length,
            })}
          </p>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!table.getCanPreviousPage()}
              onClick={() => table.previousPage()}
            >
              {m.shared_previous()}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!table.getCanNextPage()}
              onClick={() => table.nextPage()}
            >
              {m.shared_next()}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
