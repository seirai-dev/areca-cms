import { Skeleton } from '#/components/ui/skeleton'

/**
 * Placeholder that mirrors the shape of a `DataTable` (header row + body
 * rows) so the layout doesn't jump when the real table arrives.
 */
export function TableSkeleton({
  rows = 4,
  columns = 4,
}: {
  rows?: number
  columns?: number
}) {
  return (
    <div
      className="overflow-hidden rounded-lg border bg-card"
      data-testid="table-skeleton"
      aria-busy="true"
      aria-label="Loading"
    >
      <div
        className="grid gap-4 border-b bg-muted/40 px-4 py-3"
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
      >
        {Array.from({ length: columns }, (_, index) => (
          <Skeleton key={index} className="h-4 w-2/3" />
        ))}
      </div>
      {Array.from({ length: rows }, (_, rowIndex) => (
        <div
          key={rowIndex}
          className="grid gap-4 border-b px-4 py-3 last:border-b-0"
          style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
        >
          {Array.from({ length: columns }, (_cell, colIndex) => (
            <Skeleton
              key={colIndex}
              className="h-4"
              style={{
                width: `${55 + ((rowIndex * 7 + colIndex * 13) % 35)}%`,
              }}
            />
          ))}
        </div>
      ))}
    </div>
  )
}
