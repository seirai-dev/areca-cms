import * as React from 'react'
import { cn } from '#/lib/utils'

/**
 * The one boxed surface in the product: bordered, rounded-xl, no shadow. Used
 * for overlays, the entry inspector and the release status bar. Page sections
 * use `Section` instead. `Card` is kept as an alias so existing call sites
 * keep compiling.
 */
function Surface({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="surface"
      className={cn(
        'flex flex-col gap-5 rounded-surface border border-border-default bg-background-surface p-5 text-text-primary',
        className,
      )}
      {...props}
    />
  )
}

const Card = Surface

function CardHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        '@container/card-header grid auto-rows-min grid-rows-[auto_auto] items-start gap-1.5 has-data-[slot=card-action]:grid-cols-[1fr_auto]',
        className,
      )}
      {...props}
    />
  )
}

function CardTitle({ className, ...props }: React.ComponentProps<'h3'>) {
  return (
    <h3
      data-slot="card-title"
      className={cn('text-ds-heading-5 text-text-primary', className)}
      {...props}
    />
  )
}

function CardDescription({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-description"
      className={cn('text-ds-body-sm text-text-secondary', className)}
      {...props}
    />
  )
}

function CardAction({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-action"
      className={cn(
        'col-start-2 row-span-2 row-start-1 self-start justify-self-end',
        className,
      )}
      {...props}
    />
  )
}

function CardContent({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div data-slot="card-content" className={cn('', className)} {...props} />
  )
}

function CardFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-footer"
      className={cn('flex items-center', className)}
      {...props}
    />
  )
}

export {
  Card,
  Surface,
  CardHeader,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
}
