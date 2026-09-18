import type { ReactNode } from 'react'

import { cn } from '#/lib/utils'
import { absoluteTimeLabel, formatRelativeTime } from '#/lib/relative-time'

// Re-exported so existing call sites keep one import for time formatting.
export { absoluteTimeLabel, formatRelativeTime }

/**
 * A single vertical rail with one dot per item. Used by releases and the
 * audit log. The rail is drawn by the list, the dot by each item, so the
 * line never breaks between rows.
 */
export function Timeline({
  className,
  children,
  ...props
}: React.ComponentProps<'ol'>) {
  return (
    <ol
      data-slot="timeline"
      className={cn(
        'relative ml-[7px] border-l border-border-default pl-6',
        className,
      )}
      {...props}
    >
      {children}
    </ol>
  )
}

export type TimelineTone = 'success' | 'muted' | 'warning' | 'error' | 'accent'

const DOT_TONES: Record<TimelineTone, string> = {
  success: 'bg-status-success text-text-inverse',
  warning: 'bg-status-warning',
  error: 'bg-status-error',
  accent: 'bg-action-primary',
  muted: 'bg-border-default',
}

export function TimelineItem({
  tone = 'muted',
  marker,
  className,
  children,
  ...props
}: Omit<React.ComponentProps<'li'>, 'children'> & {
  tone?: TimelineTone
  /** Optional glyph inside the dot (12px). */
  marker?: ReactNode
  children?: ReactNode
}) {
  return (
    <li
      data-slot="timeline-item"
      className={cn('relative py-2', className)}
      {...props}
    >
      <span
        aria-hidden="true"
        className={cn(
          'absolute top-5 -left-6 flex size-3.5 -translate-x-1/2 items-center justify-center rounded-full ring-4 ring-background-default',
          DOT_TONES[tone],
          marker && 'size-5 [&>svg]:size-3',
        )}
      >
        {marker}
      </span>
      {children}
    </li>
  )
}

/** Relative time with the absolute timestamp on hover. */
export function RelativeTime({
  value,
  className,
}: {
  value: Date | string | null | undefined
  className?: string
}) {
  return (
    <span
      className={cn('whitespace-nowrap', className)}
      title={absoluteTimeLabel(value)}
    >
      {formatRelativeTime(value)}
    </span>
  )
}
