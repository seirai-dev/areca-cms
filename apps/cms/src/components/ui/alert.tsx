import * as React from 'react'
import { cva } from 'class-variance-authority'
import type { VariantProps } from 'class-variance-authority'

import { cn } from '#/lib/utils'

/**
 * Inline notice. Soft tinted card, leading icon, title and description.
 * Used for validation checklists, banners and query errors.
 */
const alertVariants = cva(
  cn(
    'relative grid w-full grid-cols-[0_1fr] items-start gap-y-0.5 rounded-card border px-4 py-3.5 text-body',
    'has-[>svg]:grid-cols-[18px_1fr] has-[>svg]:gap-x-3 [&>svg]:size-[18px] [&>svg]:translate-y-px',
  ),
  {
    variants: {
      variant: {
        default:
          'border-border-default bg-background-surface text-text-primary [&>svg]:text-icon-muted',
        info: 'border-transparent bg-accent-soft text-text-primary [&>svg]:text-icon-accent',
        success:
          'border-transparent bg-status-success-bg text-text-primary [&>svg]:text-icon-success',
        warning:
          'border-transparent bg-status-warning-bg text-text-primary [&>svg]:text-icon-warning',
        destructive:
          'border-transparent bg-status-error-bg text-text-primary [&>svg]:text-icon-error',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

function Alert({
  className,
  variant,
  ...props
}: React.ComponentProps<'div'> & VariantProps<typeof alertVariants>) {
  return (
    <div
      data-slot="alert"
      role="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  )
}

function AlertTitle({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-title"
      className={cn('col-start-2 font-semibold text-text-primary', className)}
      {...props}
    />
  )
}

function AlertDescription({
  className,
  ...props
}: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-description"
      className={cn(
        'col-start-2 grid justify-items-start gap-1 text-callout text-text-secondary [&_p]:leading-relaxed',
        className,
      )}
      {...props}
    />
  )
}

export { Alert, AlertTitle, AlertDescription, alertVariants }
