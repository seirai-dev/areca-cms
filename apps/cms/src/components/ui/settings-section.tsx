import * as React from 'react'

import { cn } from '#/lib/utils'

/**
 * Description-left / controls-right settings section (brief §2.2): a 280px
 * left column with a title and one sentence, a card of controls on the
 * right. Stacks below 900px. `danger` tints the card for destructive zones.
 */
export function SettingsSection({
  title,
  description,
  children,
  danger = false,
  bare = false,
  className,
  id,
  ...props
}: Omit<React.ComponentProps<'section'>, 'title'> & {
  title: React.ReactNode
  description?: React.ReactNode
  /** Red-tinted border for "Danger zone". */
  danger?: boolean
  /** Render children without the card wrapper (for inset lists). */
  bare?: boolean
}) {
  const headingId = React.useId()
  return (
    <section
      id={id}
      aria-labelledby={headingId}
      data-slot="settings-section"
      className={cn(
        'grid gap-4 border-t border-border-default py-8 first:border-t-0 first:pt-0 min-[900px]:grid-cols-[280px_minmax(0,1fr)] min-[900px]:gap-10',
        className,
      )}
      {...props}
    >
      <div className="grid content-start gap-1">
        <h2 id={headingId} className="text-headline text-text-primary">
          {title}
        </h2>
        {description ? (
          <p className="max-w-[40ch] text-callout text-text-secondary">
            {description}
          </p>
        ) : null}
      </div>
      {bare ? (
        <div className="min-w-0">{children}</div>
      ) : (
        <div
          className={cn(
            'grid min-w-0 gap-5 p-5 surface-card',
            danger && 'border-[color-mix(in_oklab,var(--color-status-error)_30%,transparent)]',
          )}
        >
          {children}
        </div>
      )}
    </section>
  )
}

/** A row inside a settings card: label + help on the left, control right. */
export function SettingsRow({
  label,
  description,
  htmlFor,
  children,
  className,
}: {
  label: React.ReactNode
  description?: React.ReactNode
  htmlFor?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-between gap-x-6 gap-y-2',
        className,
      )}
    >
      <div className="grid min-w-0 flex-1 gap-0.5">
        <label
          htmlFor={htmlFor}
          className="text-[14px] leading-5 font-medium text-text-primary"
        >
          {label}
        </label>
        {description ? (
          <p className="text-callout text-text-secondary">{description}</p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  )
}
