import { CheckCircle } from '@phosphor-icons/react'

import { cn } from '#/lib/utils'

import type { RingState } from './language-state'

const RADIUS = 5.25
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

/**
 * Completion glyph for one language, 14px (language bar and status list).
 * Complete: a filled check in success. Partial: a ring with an arc for the
 * filled share. Not started: an empty ring. A required language that is not
 * complete uses the warning tone. Decorative: the state is in the tooltip
 * text or the row label.
 */
export function LanguageRing({
  state,
  fraction,
  warning,
  className,
}: {
  state: RingState
  fraction: number
  warning: boolean
  className?: string
}) {
  if (state === 'complete') {
    return (
      <CheckCircle
        aria-hidden="true"
        weight="fill"
        className={cn('size-3.5 shrink-0 text-status-success', className)}
      />
    )
  }
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 14 14"
      width={14}
      height={14}
      className={cn(
        'size-3.5 shrink-0',
        warning ? 'text-status-warning' : 'text-border-strong',
        className,
      )}
      data-state={state}
    >
      <circle
        cx={7}
        cy={7}
        r={RADIUS}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
      />
      {state === 'partial' ? (
        <circle
          cx={7}
          cy={7}
          r={RADIUS}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.75}
          strokeLinecap="round"
          strokeDasharray={`${fraction * CIRCUMFERENCE} ${CIRCUMFERENCE}`}
          transform="rotate(-90 7 7)"
          className={warning ? undefined : 'text-text-secondary'}
        />
      ) : null}
    </svg>
  )
}
