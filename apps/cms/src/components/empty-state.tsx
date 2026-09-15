import type { ReactNode } from 'react'

import { cn } from '#/lib/utils'

/** Flat empty state: an invitation to act, not a boxed placeholder. */
export function EmptyState({
  title,
  description,
  action,
  icon,
  className,
}: {
  title: string
  description?: ReactNode
  action?: ReactNode
  icon?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-start gap-2 border-t py-8 sm:items-center sm:text-center',
        className,
      )}
    >
      {icon ? (
        <div className="mb-1 text-fern-400 [&>svg]:size-6">{icon}</div>
      ) : null}
      <p className="text-base font-semibold">{title}</p>
      {description ? (
        <p className="max-w-prose text-sm text-muted-foreground">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  )
}
