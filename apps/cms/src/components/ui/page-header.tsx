import type { ReactNode } from 'react'

import { cn } from '#/lib/utils'

/**
 * Page header (brief §2.2): a display title, a one-line quiet subtitle, and a
 * right-aligned action cluster with at most one primary button. `eyebrow`
 * sits above the title (back link, breadcrumb); `size="sm"` is for section
 * headings inside a page.
 */
export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
  meta,
  size = 'lg',
  className,
}: {
  title: ReactNode
  /** One quiet line under the title. */
  description?: ReactNode
  actions?: ReactNode
  eyebrow?: ReactNode
  /** Whisper line under the description (counts, route patterns). */
  meta?: ReactNode
  size?: 'lg' | 'sm'
  className?: string
}) {
  const Heading = size === 'lg' ? 'h1' : 'h2'
  return (
    <header
      data-slot="page-header"
      className={cn(
        'flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between sm:gap-8',
        size === 'sm' && 'sm:items-center',
        className,
      )}
    >
      <div className="grid min-w-0 gap-1">
        {eyebrow ? (
          <div className="mb-1 text-callout text-text-muted">{eyebrow}</div>
        ) : null}
        <Heading
          className={cn(
            'text-balance text-text-primary',
            size === 'lg' ? 'text-display' : 'text-title-2',
          )}
        >
          {title}
        </Heading>
        {description ? (
          <p className="max-w-[65ch] text-[15px] leading-[22px] text-text-secondary">
            {description}
          </p>
        ) : null}
        {meta ? (
          <p className="text-caption font-normal text-text-muted">{meta}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </header>
  )
}
