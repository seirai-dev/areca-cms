import { ChevronLeft, ChevronRight } from 'lucide-react'

import { Button } from '#/components/ui/button'
import { m } from '#/paraglide/messages'

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
  noun = m.shared_items(),
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
        {m.shared_total_noun({ total, noun })}
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
          ? m.shared_range_of_total({ start, end, total, noun })
          : m.shared_range({ start, end })}
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
          {m.shared_previous()}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!canNext || isFetching}
          onClick={() => onChange(offset + limit)}
        >
          {m.shared_next()}
          <ChevronRight />
        </Button>
      </div>
    </div>
  )
}
