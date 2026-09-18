import type { ReactNode } from 'react'

import { cn } from '#/lib/utils'

export type SectionLink = { id: string; label: string; danger?: boolean }

/**
 * Two-column settings layout: a sticky anchor list on the left, sections on
 * the right. Each section is a plain `<section id>` with a heading; the list
 * simply links to the ids, so it works without JavaScript.
 */
export function SectionedPage({
  links,
  children,
  aside,
}: {
  links: SectionLink[]
  children: ReactNode
  /** Optional sticky column on the right (e.g. a live preview). */
  aside?: ReactNode
}) {
  return (
    <div
      className={cn(
        // 5rem of bottom gutter so the sticky SaveBar never covers the last
        // field of the last section.
        'grid gap-8 pb-20 lg:grid-cols-[10rem_minmax(0,1fr)]',
        aside && 'xl:grid-cols-[10rem_minmax(0,1fr)_minmax(0,22rem)]',
      )}
    >
      <nav
        aria-label="Sections"
        className="hidden self-start lg:sticky lg:top-[calc(var(--app-header-h)+1.5rem)] lg:block"
      >
        <ul className="grid gap-0.5 border-l border-border-subtle">
          {links.map((link) => (
            <li key={link.id}>
              <a
                href={`#${link.id}`}
                className={cn(
                  '-ml-px block border-l border-transparent py-1 pl-3 text-ds-label-md text-text-muted transition-colors hover:border-action-primary hover:text-text-primary',
                  'aria-[current=page]:border-action-primary aria-[current=page]:text-text-primary',
                  link.danger &&
                    'hover:border-border-error hover:text-text-error',
                )}
              >
                {link.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <div className="grid min-w-0 gap-10">{children}</div>
      {aside ? (
        <div className="self-start xl:sticky xl:top-[calc(var(--app-header-h)+1.5rem)]">
          {aside}
        </div>
      ) : null}
    </div>
  )
}

export function PageSection({
  id,
  title,
  description,
  danger,
  children,
}: {
  id: string
  title: ReactNode
  description?: ReactNode
  danger?: boolean
  children: ReactNode
}) {
  return (
    <section
      id={id}
      className={cn(
        'grid scroll-mt-24 gap-5 border-t pt-8',
        danger ? 'border-border-error' : 'border-border-subtle',
      )}
    >
      <div className="grid gap-1">
        <h2
          className={cn(
            'text-ds-heading-4',
            danger ? 'text-text-error' : 'text-text-primary',
          )}
        >
          {title}
        </h2>
        {description ? (
          <p className="max-w-[65ch] text-ds-body-sm text-text-secondary">
            {description}
          </p>
        ) : null}
      </div>
      {children}
    </section>
  )
}
