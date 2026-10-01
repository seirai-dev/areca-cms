import * as React from 'react'

import { cn } from '#/lib/utils'

/**
 * Card: surface, 16px radius, hairline border, near-zero shadow, 20px padding
 * (brief §2.2, §4.3). `interactive` adds the hover lift used by grid cards.
 */
function Card({
  className,
  interactive = false,
  padded = true,
  ...props
}: React.ComponentProps<'div'> & {
  interactive?: boolean
  /** Set false for cards whose content runs edge to edge (covers, lists). */
  padded?: boolean
}) {
  return (
    <div
      data-slot="card"
      className={cn(
        'flex flex-col gap-4 text-text-primary surface-card',
        padded && 'p-5',
        interactive &&
          'transition-[transform,box-shadow,border-color] duration-200 ease-(--ease-standard) hover:-translate-y-0.5 hover:border-border-strong hover:shadow-raise motion-reduce:hover:translate-y-0',
        className,
      )}
      {...props}
    />
  )
}

export { Card }
