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
  const Heading = size === 'lg' ? 'h1' : 'h2'
  return (
    <div
      className={cn(
        'flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-6',
        size === 'sm' && 'sm:items-center',
        className,
      )}
    >
      <div className="min-w-0 space-y-1">
        {eyebrow ? (
          <div className="text-ds-body-sm text-text-muted">{eyebrow}</div>
        ) : null}
        <Heading
          className={cn(
            'text-balance',
            size === 'lg' ? 'text-ds-heading-2' : 'text-ds-heading-4',
          )}
        >
          {title}
        </Heading>
        {description ? (
          <p className="max-w-[65ch] text-ds-body-sm text-text-secondary">
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
