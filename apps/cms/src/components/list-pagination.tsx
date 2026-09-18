import { Button } from '#/components/ui/button'
import { m } from '#/paraglide/messages'
import { CaretLeft, CaretRight } from '@phosphor-icons/react'

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
  nounSingular = m.shared_item(),
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
  /** Used when exactly one row exists, so lists never read "1 entries". */
  nounSingular?: string
}) {
  const start = count === 0 ? 0 : offset + 1
  const end = offset + count
  const canPrev = offset > 0
  const canNext = typeof total === 'number' ? end < total : Boolean(hasMore)
  const totalNoun = total === 1 ? nounSingular : noun

  if (!canPrev && !canNext) {
    return typeof total === 'number' && total > 0 ? (
      <p className="text-ds-body-sm text-text-muted">
        {m.shared_total_noun({ total, noun: totalNoun })}
      </p>
    ) : null
  }

  return (
    <div
      className="flex flex-wrap items-center justify-between gap-2"
      data-testid="list-pagination"
    >
      <p className="text-ds-body-sm text-text-muted">
        {typeof total === 'number'
          ? m.shared_range_of_total({ start, end, total, noun: totalNoun })
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
          <CaretLeft />
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
          <CaretRight />
        </Button>
      </div>
    </div>
  )
}
