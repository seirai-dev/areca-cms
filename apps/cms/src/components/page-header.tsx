import type { ReactNode } from 'react'

import { cn } from '#/lib/utils'

/**
 * Page title block. Actions sit to the right on wide screens and below the
 * title on narrow ones. Pass `eyebrow` for a small line above the title
 * (e.g. a back link) and `size="sm"` for section headings inside a page.
 */
export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
  size = 'lg',
  className,
}: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  eyebrow?: ReactNode
  size?: 'lg' | 'sm'
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6',
        className,
      )}
    >
      <div className="min-w-0 space-y-1">
        {eyebrow ? <div className="text-sm">{eyebrow}</div> : null}
        <h1
          className={cn(
            'font-semibold tracking-tight text-balance',
            size === 'lg' ? 'text-3xl' : 'text-lg',
          )}
        >
          {title}
        </h1>
        {description ? (
          <p className="text-sm text-muted-foreground sm:text-base">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {actions}
        </div>
      ) : null}
    </div>
  )
}
