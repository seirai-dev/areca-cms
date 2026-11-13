import * as React from 'react'

import { absoluteTimeLabel, formatRelativeTime } from '#/lib/relative-time'
import type { StatusTone } from '#/lib/status'
import { cn } from '#/lib/utils'

export { absoluteTimeLabel }

/**
 * Activity timeline in the style of the "Proposal Activity" reference: round
 * icon nodes on a hairline, a title line, the time, and an optional card body.
 * Used by the Go‑live releases list, the Activity panel and entry history.
 */
export function Timeline({
  className,
  children,
  ...props
}: React.ComponentProps<'ol'>) {
  return (
    <ol
      data-slot="timeline"
      className={cn('relative grid', className)}
      {...props}
    >
      {children}
    </ol>
  )
}

const NODE_TONES: Record<StatusTone | 'plain', string> = {
  plain: 'bg-background-surface text-icon-default border border-border-default',
  neutral: 'bg-background-subtle text-icon-muted',
  accent: 'bg-accent-soft text-icon-accent',
  success: 'bg-status-success-bg text-icon-success',
  warning: 'bg-status-warning-bg text-icon-warning',
  error: 'bg-status-error-bg text-icon-error',
}

export function TimelineItem({
  icon,
  tone = 'neutral',
  title,
  time,
  meta,
  actions,
  className,
  children,
  ...props
}: Omit<React.ComponentProps<'li'>, 'title'> & {
  /** Glyph inside the node (an icon, an avatar). */
  icon?: React.ReactNode
  tone?: StatusTone | 'plain'
  title?: React.ReactNode
  /** Usually a `<RelativeTime />`. */
  time?: React.ReactNode
  /** Quiet second line ("by Kaan"). */
  meta?: React.ReactNode
  actions?: React.ReactNode
}) {
  return (
    <li
      data-slot="timeline-item"
      className={cn(
        'group/timeline-item relative grid grid-cols-[28px_minmax(0,1fr)] gap-x-3 pb-5 last:pb-0',
        className,
      )}
      {...props}
    >
      {/* the hairline to the next node */}
      <span
        aria-hidden="true"
        className="absolute top-8 bottom-1 left-[13.5px] w-px bg-border-default group-last/timeline-item:hidden"
      />
      <span
        aria-hidden="true"
        className={cn(
          'relative z-[1] grid size-7 place-content-center overflow-hidden rounded-full ring-4 ring-[var(--timeline-ring,var(--color-background-elevated))] [&>svg]:size-3.5',
          NODE_TONES[tone],
        )}
      >
        {icon}
      </span>
      <div className="grid min-w-0 gap-2 pt-[3px]">
        {title || time || actions ? (
          <div className="flex min-w-0 items-start gap-2">
            <div className="grid min-w-0 flex-1 gap-0.5">
              <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                {title ? (
                  <span className="text-[14px] leading-5 font-medium text-text-primary">
                    {title}
                  </span>
                ) : null}
                {time ? (
                  <span className="text-caption font-normal text-text-muted tnum">
                    {time}
                  </span>
                ) : null}
              </div>
              {meta ? (
                <div className="text-callout text-text-secondary">{meta}</div>
              ) : null}
            </div>
            {actions ? (
              <div className="-mt-1 flex shrink-0 items-center gap-1">
                {actions}
              </div>
            ) : null}
          </div>
        ) : null}
        {children}
      </div>
    </li>
  )
}

/** Card body under a timeline item. */
export function TimelineCard({
  className,
  ...props
}: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="timeline-card"
      className={cn(
        'rounded-[12px] border border-border-default bg-background-surface px-3.5 py-3 text-callout text-text-secondary',
        className,
      )}
      {...props}
    />
  )
}

/** Relative time with the absolute timestamp on hover. */
export function RelativeTime({
  value,
  title,
  className,
}: {
  value: Date | string | null | undefined
  /** Replaces the absolute timestamp tooltip. */
  title?: string
  className?: string
}) {
  const iso =
    value instanceof Date
      ? value.toISOString()
      : typeof value === 'string'
        ? value
        : undefined
  return (
    <time
      dateTime={iso}
      className={cn('whitespace-nowrap', className)}
      title={title ?? absoluteTimeLabel(value)}
    >
      {formatRelativeTime(value)}
    </time>
  )
}
