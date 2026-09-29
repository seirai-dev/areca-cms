import * as React from 'react'

import { cn } from '#/lib/utils'

/** Loading placeholder with a quiet shimmer (static under reduced motion). */
function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden="true"
      className={cn(
        'rounded-[8px] bg-background-subtle',
        'bg-[linear-gradient(90deg,transparent_0%,var(--color-surface-state-hover)_50%,transparent_100%)] bg-size-[200%_100%] animate-shimmer',
        className,
      )}
      {...props}
    />
  )
}

export { Skeleton }
