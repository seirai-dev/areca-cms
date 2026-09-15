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
  tableFeatures,
  useTable,
} from '@tanstack/react-table'
import type {
  ColumnDef,
  PaginationState,
  RowData,
  SortingState,
} from '@tanstack/react-table'
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'

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

const dataTableFeatures = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: {
    alphanumeric: sortFn_alphanumeric,
    basic: sortFn_basic,
    datetime: sortFn_datetime,
  },
  rowPaginationFeature,
  paginatedRowModel: createPaginatedRowModel(),
})

export type DataTableFeatures = typeof dataTableFeatures

export const createDataColumns = <TData extends RowData>() =>
  createColumnHelper<DataTableFeatures, TData>()

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
  emptyMessage = 'No results.',
  pageSize,
  initialSorting = [],
  getRowProps,
  caption,
}: {
  columns: Array<ColumnDef<DataTableFeatures, TData>>
  data: Array<TData>
  emptyMessage?: ReactNode
  pageSize?: number
  initialSorting?: SortingState
  getRowProps?: (row: TData) => React.ComponentProps<typeof TableRow>
  caption?: ReactNode
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
      <div className="max-w-full overflow-hidden">
        <Table>
          {caption ? <caption className="sr-only">{caption}</caption> : null}
          <TableHeader>
            {table.getHeaderGroups().map((group) => (
              <TableRow
                key={group.id}
                className="border-b-2 border-foreground/70 hover:bg-transparent"
              >
                {group.headers.map((header) => {
                  const canSort = header.column.getCanSort()
                  const sorted = header.column.getIsSorted()
                  return (
                    <TableHead
                      key={header.id}
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
                            '-ml-2 inline-flex h-8 items-center gap-1 rounded-md px-2 text-left font-medium hover:bg-muted hover:text-foreground',
                            sorted && 'text-foreground',
                          )}
                          onClick={header.column.getToggleSortingHandler()}
                        >
                          <table.FlexRender header={header} />
                          {sorted === 'asc' ? (
                            <ArrowUp className="size-3.5" />
                          ) : sorted === 'desc' ? (
                            <ArrowDown className="size-3.5" />
                          ) : (
                            <ArrowUpDown className="size-3.5 opacity-40" />
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
                    <TableCell key={cell.id}>
                      <table.FlexRender cell={cell} />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow className="hover:bg-transparent">
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center text-muted-foreground"
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
          <p className="text-sm text-muted-foreground">
            Page {pagination.pageIndex + 1} of {pageCount} · {data.length} rows
          </p>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!table.getCanPreviousPage()}
              onClick={() => table.previousPage()}
            >
              Previous
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!table.getCanNextPage()}
              onClick={() => table.nextPage()}
            >
              Next
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
