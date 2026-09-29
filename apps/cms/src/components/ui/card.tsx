import * as React from 'react'

import { cn } from '#/lib/utils'

/**
 * Card: surface, 16px radius, hairline border, near-zero shadow, 20px padding
 * (brief §2.2, §4.3). `interactive` adds the hover lift used by grid cards.
 * `Surface` is the legacy name, kept so old screens compile.
 */
function Card({
  className,
  interactive = false,
  padded = true,
  ...props
}: React.ComponentProps<'div'> & {
  interactive?: boolean
  /** Set false for cards whose content runs edge to edge (covers, lists). */
  padded?: boolean
}) {
  return (
    <div
      data-slot="card"
      className={cn(
        'flex flex-col gap-4 text-text-primary surface-card',
        padded && 'p-5',
        interactive &&
          'transition-[transform,box-shadow,border-color] duration-200 ease-(--ease-standard) hover:-translate-y-0.5 hover:border-border-strong hover:shadow-raise motion-reduce:hover:translate-y-0',
        className,
      )}
      {...props}
    />
  )
}

/** LEGACY alias (phase 1 bridge). */
const Surface = Card

function CardHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        '@container/card-header grid auto-rows-min grid-rows-[auto_auto] items-start gap-1 has-data-[slot=card-action]:grid-cols-[1fr_auto]',
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
      className={cn('text-headline text-text-primary', className)}
      {...props}
    />
  )
}

function CardDescription({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-description"
      className={cn('text-callout text-text-secondary', className)}
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
  return <div data-slot="card-content" className={cn('', className)} {...props} />
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
