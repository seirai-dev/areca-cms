import * as React from 'react'
import { Slot } from 'radix-ui'
import { CaretRight } from '@phosphor-icons/react'

import { cn } from '#/lib/utils'

/**
 * iOS-Settings grouped list (brief §2.2): rows inside one rounded card,
 * separated by hairlines inset from the leading icon. Rows are 52–60px with
 * 16px padding.
 *
 *   <InsetGroup title="Members" footer="…">
 *     <InsetList>
 *       <InsetRow leading={<Avatar/>} title="Kaan" subtitle="kaan@…" trailing={…} />
 *     </InsetList>
 *   </InsetGroup>
 */
function InsetGroup({
  title,
  description,
  actions,
  footer,
  className,
  children,
  ...props
}: Omit<React.ComponentProps<'section'>, 'title'> & {
  title?: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
  footer?: React.ReactNode
}) {
  return (
    <section
      data-slot="inset-group"
      className={cn('grid gap-2', className)}
      {...props}
    >
      {title || actions ? (
        <div className="flex items-end justify-between gap-3 px-1">
          <div className="grid gap-0.5">
            {title ? (
              <h2 className="text-headline text-text-primary">{title}</h2>
            ) : null}
            {description ? (
              <p className="text-callout text-text-secondary">{description}</p>
            ) : null}
          </div>
          {actions ? (
            <div className="flex shrink-0 items-center gap-2">{actions}</div>
          ) : null}
        </div>
      ) : null}
      {children}
      {footer ? (
        <p className="px-1 text-caption font-normal text-text-muted">
          {footer}
        </p>
      ) : null}
    </section>
  )
}

function InsetList({ className, ...props }: React.ComponentProps<'ul'>) {
  return (
    <ul
      data-slot="inset-list"
      className={cn('overflow-hidden surface-card', className)}
      {...props}
    />
  )
}

/**
 * One row. Pass `asChild` to render the row as a Link/button (the whole row
 * becomes interactive and gets a hover fill and a chevron when `chevron`).
 */
function InsetRow({
  leading,
  title,
  subtitle,
  trailing,
  chevron = false,
  asChild = false,
  inset = true,
  wrapSubtitle = false,
  className,
  children,
  ...props
}: Omit<React.ComponentProps<'div'>, 'title'> & {
  leading?: React.ReactNode
  title?: React.ReactNode
  subtitle?: React.ReactNode
  trailing?: React.ReactNode
  chevron?: boolean
  asChild?: boolean
  /** Inset the separator to start after the leading slot. */
  inset?: boolean
  /** Wrap a long subtitle onto more lines instead of truncating it. */
  wrapSubtitle?: boolean
}) {
  const Comp = asChild ? Slot.Root : 'div'
  const layout = (extra: React.ReactNode) => (
    <>
      {leading ? (
        <span className="flex shrink-0 items-center text-icon-default [&>svg]:size-5">
          {leading}
        </span>
      ) : null}
      <span className="grid min-w-0 flex-1 gap-0.5">
        {title ? (
          <span className="truncate text-[14px] leading-5 font-medium text-text-primary">
            {title}
          </span>
        ) : null}
        {subtitle ? (
          <span
            className={cn(
              'text-callout text-text-secondary',
              wrapSubtitle ? 'min-w-0 break-words' : 'truncate',
            )}
          >
            {subtitle}
          </span>
        ) : null}
        {extra}
      </span>
      {trailing ? (
        <span className="flex shrink-0 items-center gap-2 text-callout text-text-secondary">
          {trailing}
        </span>
      ) : null}
      {chevron ? (
        <CaretRight
          weight="bold"
          className="size-3.5 shrink-0 text-icon-muted"
        />
      ) : null}
    </>
  )
  // With `asChild` the single child (a Link, a button) becomes the row and
  // its own children render in the text column.
  const child =
    asChild && React.isValidElement<{ children?: React.ReactNode }>(children)
      ? React.cloneElement(children, undefined, layout(children.props.children))
      : null

  return (
    <li
      data-slot="inset-row"
      className={cn(
        'relative',
        // hairline separator, inset from the leading slot
        'after:absolute after:right-0 after:bottom-0 after:h-px after:bg-border-default last:after:hidden',
        inset && leading ? 'after:left-[60px]' : 'after:left-4',
      )}
    >
      <Comp
        className={cn(
          'flex min-h-[56px] w-full items-center gap-3 px-4 py-2.5 text-left',
          asChild &&
            'outline-none transition-colors duration-150 hover:bg-surface-state-hover focus-visible:bg-surface-state-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-border-focus active:bg-surface-state-pressed',
          className,
        )}
        {...props}
      >
        {child ?? layout(children)}
      </Comp>
    </li>
  )
}

/** Leading icon tile for rows: 32px rounded square, tinted. */
function InsetIcon({
  tone = 'neutral',
  className,
  children,
}: {
  tone?: 'neutral' | 'accent' | 'success' | 'warning' | 'error'
  className?: string
  children: React.ReactNode
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'grid size-8 place-content-center rounded-[9px] [&>svg]:size-[18px]',
        tone === 'neutral' && 'bg-background-subtle text-icon-default',
        tone === 'accent' && 'bg-accent-soft text-icon-accent',
        tone === 'success' && 'bg-status-success-bg text-icon-success',
        tone === 'warning' && 'bg-status-warning-bg text-icon-warning',
        tone === 'error' && 'bg-status-error-bg text-icon-error',
        className,
      )}
    >
      {children}
    </span>
  )
}

export { InsetGroup, InsetList, InsetRow, InsetIcon }
