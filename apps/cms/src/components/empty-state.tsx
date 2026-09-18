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
        'flex flex-col items-start gap-2 py-12 sm:items-center sm:text-center',
        className,
      )}
    >
      {icon ? (
        <div className="mb-1 text-icon-accent [&>svg]:size-6">{icon}</div>
      ) : null}
      <p className="text-ds-heading-5 text-text-primary">{title}</p>
      {description ? (
        <p className="max-w-prose text-ds-body-sm text-text-secondary">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  )
}
