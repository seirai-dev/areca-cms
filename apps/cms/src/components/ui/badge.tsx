import * as React from 'react'
import { cva } from 'class-variance-authority'
import type { VariantProps } from 'class-variance-authority'
import { cn } from '#/lib/utils'
import { Slot } from 'radix-ui'

const badgeVariants = cva(
  cn(
    'inline-flex w-fit shrink-0 items-center justify-center gap-1.5 overflow-hidden',
    'rounded-full border border-transparent px-2 py-0.5',
    'font-sans text-xs leading-4 font-medium whitespace-nowrap',
    'transition-colors duration-[120ms] ease-(--motion-ease-standard)',
    'outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-strong',
    '[&>svg]:pointer-events-none [&>svg]:size-3',
  ),
  {
    variants: {
      variant: {
        default: 'bg-action-secondary text-text-primary',
        secondary: 'bg-action-secondary text-text-primary',
        outline:
          'border-border-default text-text-primary [a&]:hover:bg-surface-state-hover',
        success: 'bg-status-success-bg text-text-success',
        warning: 'bg-status-warning-bg text-text-warning',
        error: 'bg-status-error-bg text-text-error',
        destructive: 'bg-status-error-bg text-text-error',
        info: 'bg-status-info-bg text-text-info',
        muted: 'bg-background-subtle text-text-muted',
        ghost: '[a&]:hover:bg-surface-state-hover',
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
    /** Leading semantic dot; reserved for live/pending states. */
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

export { Badge, badgeVariants }
