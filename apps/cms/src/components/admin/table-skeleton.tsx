import { Skeleton } from '#/components/ui/skeleton'

export function TableSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="grid gap-2" data-testid="table-skeleton">
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className="h-10 w-full" />
      ))}
    </div>
  )
}
