import type * as React from 'react'
import { cn } from '#/lib/utils'

/**
 * A flat page section: heading-4 title, body-sm description, optional actions
 * on the right, and an optional hairline above it separating it from the
 * previous section. No box, no shadow.
 */
export function Section({
  title,
  description,
  actions,
  hairline = true,
  className,
  headerClassName,
  children,
  ...props
}: Omit<React.ComponentProps<'section'>, 'title'> & {
  title?: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
  /** Draw a `border-subtle` rule above the section. */
  hairline?: boolean
  headerClassName?: string
}) {
  return (
    <section
      data-slot="section"
      className={cn(
        'flex flex-col gap-5',
        hairline && 'border-t border-border-subtle pt-8',
        className,
      )}
      {...props}
    >
      {title || description || actions ? (
        <div
          className={cn(
            'flex flex-wrap items-start justify-between gap-3',
            headerClassName,
          )}
        >
          <div className="flex flex-col gap-1">
            {title ? (
              <h2 className="text-ds-heading-4 text-text-primary">{title}</h2>
            ) : null}
            {description ? (
              <p className="text-ds-body-sm text-text-secondary">
                {description}
              </p>
            ) : null}
          </div>
          {actions ? (
            <div className="flex shrink-0 items-center gap-2">{actions}</div>
          ) : null}
        </div>
      ) : null}
      {children}
    </section>
  )
}
