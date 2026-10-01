import * as React from 'react'

import { cn } from '#/lib/utils'

const TAG_TONES = {
  neutral: 'bg-status-neutral-bg text-text-secondary',
  accent: 'bg-accent-soft text-accent-text',
  success: 'bg-status-success-bg text-text-success',
  warning: 'bg-status-warning-bg text-text-warning',
  error: 'bg-status-error-bg text-text-error',
  outline: 'border border-border-strong text-text-muted',
} as const

/** Small quiet rectangular marker: "Off", "You", "Expired", "PDF". */
function Tag({
  tone = 'neutral',
  className,
  ...props
}: React.ComponentProps<'span'> & { tone?: keyof typeof TAG_TONES }) {
  return (
    <span
      data-slot="tag"
      className={cn(
        'inline-flex h-[18px] shrink-0 items-center rounded-[5px] px-1.5 text-[11px] leading-none font-semibold tracking-[0.01em] whitespace-nowrap',
        TAG_TONES[tone],
        className,
      )}
      {...props}
    />
  )
}

export { Tag }
