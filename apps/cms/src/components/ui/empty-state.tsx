import type { ReactNode } from 'react'

import { cn } from '#/lib/utils'

/**
 * Empty state (brief §3.x): an illustrative icon well (a soft tinted tile
 * inside a ring), a title, one sentence, and an action. `card` wraps it in a
 * card; otherwise it sits flat on the canvas.
 */
export function EmptyState({
  title,
  description,
  action,
  icon,
  tone = 'accent',
  card = false,
  size = 'md',
  className,
  ...props
}: {
  title: string
  description?: ReactNode
  action?: ReactNode
  icon?: ReactNode
  tone?: 'accent' | 'neutral' | 'success' | 'warning' | 'error'
  card?: boolean
  size?: 'sm' | 'md'
  className?: string
  'data-testid'?: string
}) {
  return (
    <div
      data-slot="empty-state"
      data-testid={props['data-testid']}
      className={cn(
        'flex flex-col items-center gap-1.5 text-center',
        size === 'md' ? 'px-6 py-14' : 'px-4 py-8',
        card && 'surface-card',
        className,
      )}
    >
      {icon ? (
        <div
          aria-hidden="true"
          className={cn(
            'relative mb-3 grid place-content-center rounded-[18px] ring-8',
            size === 'md'
              ? 'size-14 [&>svg]:size-7'
              : 'size-11 rounded-[14px] ring-[6px] [&>svg]:size-5',
            tone === 'accent' &&
              'bg-accent-soft text-icon-accent ring-accent-soft/40',
            tone === 'neutral' &&
              'bg-background-subtle text-icon-muted ring-background-subtle/50',
            tone === 'success' &&
              'bg-status-success-bg text-icon-success ring-status-success-bg/40',
            tone === 'warning' &&
              'bg-status-warning-bg text-icon-warning ring-status-warning-bg/40',
            tone === 'error' &&
              'bg-status-error-bg text-icon-error ring-status-error-bg/40',
          )}
        >
          {icon}
        </div>
      ) : null}
      <p
        className={cn(
          'text-text-primary',
          size === 'md' ? 'text-title-2' : 'text-headline',
        )}
      >
        {title}
      </p>
      {description ? (
        <p className="max-w-[46ch] text-body text-text-secondary">
          {description}
        </p>
      ) : null}
      {action ? (
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          {action}
        </div>
      ) : null}
    </div>
  )
}
