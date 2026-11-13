import type * as React from 'react'

import { cn } from '#/lib/utils'

export function Section({
  title,
  children,
  className,
  actions,
}: {
  title?: React.ReactNode
  children: React.ReactNode
  className?: string
  actions?: React.ReactNode
}) {
  return (
    <section className={cn('grid gap-3 px-5 py-5', className)}>
      {title ? (
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-overline text-text-muted">{title}</h3>
          {actions}
        </div>
      ) : null}
      {children}
    </section>
  )
}
