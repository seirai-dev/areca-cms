import { ChevronLeft, ChevronRight } from 'lucide-react'

import { Button } from '#/components/ui/button'

/**
 * Prev/next controls for server-paged lists (limit/offset).
 *
 * Pass `total` when the server reports one; otherwise pass `hasMore`
 * (typically derived by requesting `limit + 1` rows).
 */
export function ListPagination({
  offset,
  limit,
  count,
  total,
  hasMore,
  onChange,
  isFetching,
  noun = 'items',
}: {
  offset: number
  limit: number
  /** Number of rows on the current page. */
  count: number
  total?: number
  hasMore?: boolean
  onChange: (offset: number) => void
  isFetching?: boolean
  noun?: string
}) {
  const start = count === 0 ? 0 : offset + 1
  const end = offset + count
  const canPrev = offset > 0
  const canNext = typeof total === 'number' ? end < total : Boolean(hasMore)

  if (!canPrev && !canNext) {
    return typeof total === 'number' && total > 0 ? (
      <p className="text-sm text-muted-foreground">
        {total} {noun}
      </p>
    ) : null
  }

  return (
    <div
      className="flex flex-wrap items-center justify-between gap-2"
      data-testid="list-pagination"
    >
      <p className="text-sm text-muted-foreground">
        {typeof total === 'number'
          ? `${start}–${end} of ${total} ${noun}`
          : `${start}–${end}`}
      </p>
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!canPrev || isFetching}
          onClick={() => onChange(Math.max(0, offset - limit))}
        >
          <ChevronLeft />
          Previous
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!canNext || isFetching}
          onClick={() => onChange(offset + limit)}
        >
          Next
          <ChevronRight />
        </Button>
      </div>
    </div>
  )
}
