import * as React from 'react'
import { cva } from 'class-variance-authority'
import type { VariantProps } from 'class-variance-authority'
import { Slot } from 'radix-ui'

import { cn } from '#/lib/utils'

/**
 * Capsule label. For entry/publication/job states use `StatusPill`; for
 * small quiet markers ("Off", "You", "Expired", counts) use `Tag`.
 */
const badgeVariants = cva(
  cn(
    'inline-flex h-[22px] w-fit shrink-0 items-center justify-center gap-1.5 overflow-hidden',
    'rounded-full border border-transparent px-2',
    'font-sans text-[12px] leading-4 font-medium whitespace-nowrap',
    'transition-colors duration-150 ease-(--ease-standard)',
    'outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus',
    '[&>svg]:pointer-events-none [&>svg]:size-3',
  ),
  {
    variants: {
      variant: {
        default: 'bg-status-neutral-bg text-text-secondary',
        secondary: 'bg-status-neutral-bg text-text-secondary',
        outline:
          'border-border-strong text-text-secondary [a&]:hover:bg-surface-state-hover',
        accent: 'bg-accent-soft text-accent-text',
        success: 'bg-status-success-bg text-text-success',
        warning: 'bg-status-warning-bg text-text-warning',
        error: 'bg-status-error-bg text-text-error',
        destructive: 'bg-status-error-bg text-text-error',
        info: 'bg-accent-soft text-accent-text',
        muted: 'bg-status-neutral-bg text-text-muted',
        ghost: 'text-text-secondary [a&]:hover:bg-surface-state-hover',
        link: 'text-text-accent underline-offset-4 [a&]:hover:underline',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

function Badge({
  className,
  variant = 'default',
  asChild = false,
  dot = false,
  children,
  ...props
}: React.ComponentProps<'span'> &
  VariantProps<typeof badgeVariants> & {
    asChild?: boolean
    /** Leading dot in the current colour. */
    dot?: boolean
  }) {
  const Comp = asChild ? Slot.Root : 'span'

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    >
      {dot ? (
        <span
          aria-hidden="true"
          className="size-1.5 shrink-0 rounded-full bg-current"
        />
      ) : null}
      {children}
    </Comp>
  )
}

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

export { Badge, Tag, badgeVariants }
