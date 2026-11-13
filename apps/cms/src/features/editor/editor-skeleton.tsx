import { Skeleton } from '#/components/ui/skeleton'
import { useVisualModeActive } from '#/features/visual/visual-mode'
import { cn } from '#/lib/utils'

/** The entry editor's loading state, also shown while its code downloads. */
export function EditorSkeleton() {
  const fullBleed = useVisualModeActive()
  return (
    <div
      className="grid gap-10"
      data-testid="entry-editor"
      data-ready="false"
      aria-busy="true"
    >
      <div
        className={cn(
          'flex h-14 items-center gap-3 border-b border-border-default px-4',
          !fullBleed && '-mx-6 -mt-6',
        )}
      >
        <Skeleton className="h-6 w-24" />
        <Skeleton className="h-5 w-14 rounded-full" />
        <span className="flex-1" />
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-[30px] w-32 rounded-[8px]" />
      </div>
      <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="mx-auto grid w-full max-w-[720px] gap-6 pt-6">
          <Skeleton className="h-11 w-3/4" />
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-5 w-5/6" />
          <Skeleton className="h-5 w-2/3" />
        </div>
        <div className="hidden gap-4 lg:grid">
          <Skeleton className="h-28 w-full rounded-card" />
          <Skeleton className="h-48 w-full rounded-card" />
        </div>
      </div>
    </div>
  )
}
