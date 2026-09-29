import * as React from 'react'
import { motion, useReducedMotion } from 'motion/react'
import {
  Archive,
  ArrowCounterClockwise,
  CircleDashed,
  PencilSimple,
  Prohibit,
} from '@phosphor-icons/react'

import {
  ENTRY_STATUS,
  JOB_STATUS,
  PUBLICATION_STATUS,
} from '#/lib/status'
import type { EntryUiStatus, StatusIconKind, StatusTone } from '#/lib/status'
import type { BuildJobStatus, PublicationStatus } from '#/lib/types'
import { SPRING_SMALL } from '#/lib/motion'
import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'

import { Hint } from './tooltip'

export const TONE_TEXT: Record<StatusTone, string> = {
  neutral: 'text-icon-muted',
  accent: 'text-icon-accent',
  success: 'text-icon-success',
  warning: 'text-icon-warning',
  error: 'text-icon-error',
}

export const TONE_PILL: Record<StatusTone, string> = {
  neutral: 'bg-status-neutral-bg text-text-secondary',
  accent: 'bg-accent-soft text-accent-text',
  success: 'bg-status-success-bg text-text-success',
  warning: 'bg-status-warning-bg text-text-warning',
  error: 'bg-status-error-bg text-text-error',
}

export const TONE_FILL: Record<StatusTone, string> = {
  neutral: 'bg-status-neutral',
  accent: 'bg-accent',
  success: 'bg-status-success',
  warning: 'bg-status-warning',
  error: 'bg-status-error',
}

/* -------------------------------------------------------------------------
   Animated status icons (brief §4.5). All of them respect reduced motion.
------------------------------------------------------------------------- */

/**
 * The live dot. `pulse="loop"` rings softly once every 4s (tray, workspace
 * card); `pulse="once"` rings once on mount (pills); `none` is still.
 */
export function LiveDot({
  pulse = 'once',
  tone = 'success',
  className,
}: {
  pulse?: 'loop' | 'once' | 'none'
  tone?: StatusTone
  className?: string
}) {
  return (
    <span
      aria-hidden="true"
      data-slot="live-dot"
      className={cn('relative inline-flex size-2 shrink-0', className)}
    >
      {pulse !== 'none' ? (
        <span
          className={cn(
            'absolute inset-0 rounded-full',
            TONE_FILL[tone],
            pulse === 'loop' ? 'animate-live-ping' : 'animate-live-ping-once',
          )}
        />
      ) : null}
      <span className={cn('relative size-2 rounded-full', TONE_FILL[tone])} />
    </span>
  )
}

/** Indeterminate ring for "going live" / building. */
export function SpinnerRing({
  size = 14,
  className,
}: {
  size?: number
  className?: string
}) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      className={cn('shrink-0 animate-spin motion-reduce:animate-none', className)}
      style={{ animationDuration: '0.9s' }}
    >
      <circle
        cx="8"
        cy="8"
        r="6.25"
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.22"
        strokeWidth="1.75"
      />
      <path
        d="M14.25 8A6.25 6.25 0 0 0 8 1.75"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  )
}

/** Clock whose minute hand ticks forward once on mount. */
export function ClockIcon({
  size = 14,
  className,
}: {
  size?: number
  className?: string
}) {
  const reduce = useReducedMotion()
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      className={cn('shrink-0', className)}
    >
      <circle
        cx="8"
        cy="8"
        r="6.25"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M8 8 L10.5 9.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <motion.path
        d="M8 8 L8 4.25"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        style={{ originX: '8px', originY: '8px', transformBox: 'view-box' }}
        initial={reduce ? false : { rotate: -30 }}
        animate={{ rotate: 0 }}
        transition={{ ...SPRING_SMALL, delay: 0.15 }}
      />
    </svg>
  )
}

/** Check that draws itself in. */
export function CheckDraw({
  size = 14,
  circle = true,
  className,
}: {
  size?: number
  circle?: boolean
  className?: string
}) {
  const reduce = useReducedMotion()
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      className={cn('shrink-0', className)}
    >
      {circle ? (
        <circle cx="8" cy="8" r="7" fill="currentColor" opacity="0.16" />
      ) : null}
      <motion.path
        d="M4.75 8.25 L7 10.5 L11.25 5.75"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={reduce ? false : { pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.32, ease: [0.2, 0.8, 0.2, 1], delay: 0.05 }}
      />
    </svg>
  )
}

/** Failed: a filled circle with an x that shakes once, 2px. */
export function FailedIcon({
  size = 14,
  className,
}: {
  size?: number
  className?: string
}) {
  const reduce = useReducedMotion()
  return (
    <motion.svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      className={cn('shrink-0', className)}
      initial={reduce ? false : { x: 0 }}
      animate={reduce ? undefined : { x: [0, -2, 2, -1.5, 1, 0] }}
      transition={{ duration: 0.4, delay: 0.1 }}
    >
      <circle cx="8" cy="8" r="7" fill="currentColor" />
      <path
        d="M5.75 5.75 L10.25 10.25 M10.25 5.75 L5.75 10.25"
        stroke="var(--color-background-surface)"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </motion.svg>
  )
}

export function StatusIcon({
  kind,
  tone = 'neutral',
  size = 14,
  pulse,
  className,
}: {
  kind: StatusIconKind
  tone?: StatusTone
  size?: number
  pulse?: 'loop' | 'once' | 'none'
  className?: string
}) {
  const color = TONE_TEXT[tone]
  const phosphor = { size, weight: 'bold' as const, className: cn('shrink-0', color, className) }
  switch (kind) {
    case 'live':
      return <LiveDot pulse={pulse ?? 'once'} tone={tone} className={className} />
    case 'dot':
      return (
        <span
          aria-hidden="true"
          className={cn('size-2 shrink-0 rounded-full', TONE_FILL[tone], className)}
        />
      )
    case 'spinner':
      return <SpinnerRing size={size} className={cn(color, className)} />
    case 'clock':
      return <ClockIcon size={size} className={cn(color, className)} />
    case 'check':
      return <CheckDraw size={size} className={cn(color, className)} />
    case 'failed':
      return <FailedIcon size={size} className={cn(color, className)} />
    case 'pencil':
      return <PencilSimple {...phosphor} />
    case 'box':
      return <Archive {...phosphor} />
    case 'queued':
      return <CircleDashed {...phosphor} />
    case 'cancelled':
      return <Prohibit {...phosphor} />
    case 'restore':
      return <ArrowCounterClockwise {...phosphor} />
    case 'replaced':
      return (
        <span
          aria-hidden="true"
          className={cn(
            'size-2 shrink-0 rounded-full border-[1.5px] border-current',
            color,
            className,
          )}
        />
      )
  }
}

/* -------------------------------------------------------------------------
   Pills
------------------------------------------------------------------------- */

/**
 * Status pill: soft tinted capsule, animated icon, short label. Keeps the raw
 * status in `data-status` for tests and styling.
 */
export function StatusPill({
  tone,
  icon,
  label,
  status,
  size = 'md',
  variant = 'soft',
  pulse,
  className,
  children,
  ...props
}: Omit<React.ComponentProps<'span'>, 'children'> & {
  tone: StatusTone
  icon?: StatusIconKind
  label: React.ReactNode
  status?: string
  size?: 'sm' | 'md'
  /** `soft` = tinted capsule; `plain` = icon + label, no fill. */
  variant?: 'soft' | 'plain'
  pulse?: 'loop' | 'once' | 'none'
  children?: React.ReactNode
}) {
  return (
    <span
      data-slot="status-pill"
      data-status={status}
      data-tone={tone}
      className={cn(
        'inline-flex w-fit shrink-0 items-center gap-1.5 font-medium whitespace-nowrap',
        variant === 'soft' &&
          cn(
            'rounded-full',
            TONE_PILL[tone],
            size === 'sm' ? 'h-5 px-1.5 text-[11.5px]' : 'h-[22px] px-2 text-[12px]',
          ),
        variant === 'plain' &&
          cn('text-text-secondary', size === 'sm' ? 'text-[12px]' : 'text-[13px]'),
        className,
      )}
      {...props}
    >
      {icon ? (
        <StatusIcon
          kind={icon}
          tone={tone}
          size={size === 'sm' ? 11 : 12}
          pulse={pulse}
        />
      ) : null}
      <span className="leading-none">{label}</span>
      {children}
    </span>
  )
}

/** Short weekday + time for scheduled pills: "Fri 9:00". */
export function formatScheduleShort(value: Date | string, locale?: string) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const now = new Date()
  const withinWeek = Math.abs(date.getTime() - now.getTime()) < 6 * 86_400_000
  return new Intl.DateTimeFormat(locale, {
    ...(withinWeek
      ? { weekday: 'short' }
      : { day: 'numeric', month: 'short' }),
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

export function EntryStatusPill({
  status,
  long = false,
  scheduledAt,
  editedSinceReady = false,
  size,
  variant,
  testId,
  className,
}: {
  status: EntryUiStatus
  long?: boolean
  scheduledAt?: Date | string | null
  /** Published entry whose draft differs from `publishedData`. */
  editedSinceReady?: boolean
  size?: 'sm' | 'md'
  variant?: 'soft' | 'plain'
  testId?: string
  className?: string
}) {
  const meta = ENTRY_STATUS[status]
  const label =
    status === 'scheduled' && scheduledAt
      ? formatScheduleShort(scheduledAt)
      : long
        ? meta.long()
        : meta.label()
  return (
    <StatusPill
      tone={meta.tone}
      icon={meta.icon}
      label={label}
      status={status}
      size={size}
      variant={variant}
      data-testid={testId}
      aria-label={status === 'scheduled' ? `${meta.label()} ${label}` : undefined}
      className={className}
    >
      {editedSinceReady ? <EditedMarker /> : null}
    </StatusPill>
  )
}

/** "Edited since ready": a small dot plus a tooltip. */
export function EditedMarker() {
  return (
    <Hint label={m.shell_status_edited_since_ready_hint()}>
      <span
        tabIndex={0}
        aria-label={m.shell_status_edited_since_ready()}
        data-testid="edited-since-ready"
        className="-mr-0.5 ml-0.5 size-1.5 rounded-full bg-status-warning outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
      />
    </Hint>
  )
}

export function PublicationStatusPill({
  status,
  testId,
  size,
  className,
}: {
  status: PublicationStatus
  testId?: string
  size?: 'sm' | 'md'
  className?: string
}) {
  const meta = PUBLICATION_STATUS[status]
  return (
    <StatusPill
      tone={meta.tone}
      icon={meta.icon}
      label={meta.label()}
      status={status}
      size={size}
      pulse="none"
      data-testid={testId}
      className={className}
    />
  )
}

export function JobStatusPill({
  status,
  size,
  className,
}: {
  status: BuildJobStatus
  size?: 'sm' | 'md'
  className?: string
}) {
  const meta = JOB_STATUS[status]
  return (
    <StatusPill
      tone={meta.tone}
      icon={meta.icon}
      label={meta.label()}
      status={status}
      size={size}
      className={className}
    />
  )
}
