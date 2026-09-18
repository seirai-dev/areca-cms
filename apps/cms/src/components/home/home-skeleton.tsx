import { Skeleton } from '#/components/ui/skeleton'

/** Home placeholder: the sites list on the left, three rail blocks right. */
export function HomeSkeleton() {
  return (
    <div className="grid gap-8 lg:grid-cols-12">
      <div className="grid gap-4 lg:col-span-8">
        <Skeleton className="h-8 w-32" />
        <div className="flex gap-2">
          <Skeleton className="h-9 flex-1 max-w-xs" />
          <Skeleton className="h-9 w-44" />
        </div>
        <div className="grid">
          <Skeleton className="h-9 w-full" />
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="mt-px h-11 w-full rounded-none" />
          ))}
        </div>
      </div>
      <div className="grid gap-6 lg:col-span-4">
        {Array.from({ length: 3 }).map((_, block) => (
          <div key={block} className="grid gap-3">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        ))}
      </div>
    </div>
  )
}
