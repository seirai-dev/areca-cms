import * as React from 'react'
import { RadioGroup as RadioGroupPrimitive } from 'radix-ui'

import { cn } from '#/lib/utils'

/**
 * Radio-style choice cards ("Editor — Can write and edit drafts."). Each card
 * is a real radio (`role=radio`) inside a radiogroup; arrow keys move.
 */
function RadioCards({
  className,
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Root>) {
  return (
    <RadioGroupPrimitive.Root
      data-slot="radio-cards"
      className={cn('grid gap-2', className)}
      {...props}
    />
  )
}

function RadioCard({
  className,
  title,
  description,
  icon,
  ...props
}: Omit<React.ComponentProps<typeof RadioGroupPrimitive.Item>, 'title'> & {
  title: React.ReactNode
  description?: React.ReactNode
  icon?: React.ReactNode
}) {
  return (
    <RadioGroupPrimitive.Item
      data-slot="radio-card"
      className={cn(
        'group/radio-card flex w-full items-start gap-3 rounded-card border border-border-default bg-background-surface p-4 text-left',
        'transition-[border-color,box-shadow,background-color] duration-150 ease-(--ease-standard)',
        'hover:border-border-strong',
        'outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus',
        'data-[state=checked]:border-accent data-[state=checked]:bg-accent-soft/50 data-[state=checked]:shadow-[0_0_0_1px_var(--color-accent)]',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <span
        aria-hidden="true"
        className="mt-0.5 grid size-[18px] shrink-0 place-content-center rounded-full border border-border-strong bg-background-surface transition-colors group-data-[state=checked]/radio-card:border-accent group-data-[state=checked]/radio-card:bg-accent"
      >
        <span className="size-1.5 scale-0 rounded-full bg-accent-contrast transition-transform duration-150 group-data-[state=checked]/radio-card:scale-100" />
      </span>
      {icon ? (
        <span className="mt-px text-icon-muted group-data-[state=checked]/radio-card:text-icon-accent [&>svg]:size-5">
          {icon}
        </span>
      ) : null}
      <span className="grid min-w-0 gap-0.5">
        <span className="text-headline text-text-primary">{title}</span>
        {description ? (
          <span className="text-callout text-text-secondary">{description}</span>
        ) : null}
      </span>
    </RadioGroupPrimitive.Item>
  )
}

export { RadioCards, RadioCard }
