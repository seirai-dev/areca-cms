import type { ReactNode } from 'react'

import { AuthArt } from '#/components/auth-art'
import { BrandMark } from '#/components/brand-mark'
import { LanguageSwitcher } from '#/components/language-switcher'
import { ThemeToggle } from '#/components/theme'
import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'

/**
 * Split auth layout (brief 4.7): the form sits on the left with the brand mark
 * pinned to the top, the right half carries the contour artwork and a short
 * statement of what the product is. Below `lg` the art collapses to a short
 * band above the form so the page still reads as branded on a phone.
 */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-svh bg-background-default lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <div className="relative flex flex-col">
        <div className="flex items-center justify-between px-6 py-6 sm:px-10">
          <BrandMark />
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <LanguageSwitcher compact />
          </div>
        </div>
        <div
          aria-hidden="true"
          className="relative h-24 overflow-hidden border-y border-border-subtle sm:h-28 lg:hidden"
        >
          <AuthArt className="absolute inset-0" />
        </div>
        <div className="flex flex-1 items-center px-6 py-12 sm:px-10">
          <div className="mx-auto w-full max-w-sm">{children}</div>
        </div>
      </div>
      <div className="relative hidden overflow-hidden border-l border-border-subtle lg:block">
        <AuthArt className="absolute inset-0" />
        <div className="absolute inset-x-0 bottom-0 p-12">
          <p className="max-w-md text-ds-heading-2 text-balance text-text-primary">
            {m.auth_panel_title()}
          </p>
          <p className="mt-2 max-w-md text-ds-body-sm text-text-secondary">
            {m.auth_panel_description()}
          </p>
        </div>
      </div>
    </div>
  )
}

/** Title + one-line description above every auth form. */
export function AuthHeading({
  title,
  description,
}: {
  title: ReactNode
  description?: ReactNode
}) {
  return (
    <div className="grid gap-1.5">
      <h1 className="text-ds-heading-2 text-text-primary">{title}</h1>
      {description ? (
        <p className="text-ds-body-sm text-text-secondary">{description}</p>
      ) : null}
    </div>
  )
}

/**
 * Inline error under a form. Auth failures are part of the form, not a
 * transient event, so they never become a toast.
 */
export function AuthError({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <p
      role="alert"
      data-testid="auth-error"
      className={cn('text-ds-body-sm text-text-error', className)}
    >
      {children}
    </p>
  )
}

/**
 * Hairline with "or continue with" above the provider buttons. Rendered only
 * when there is a form to separate them from.
 */
export function AuthDivider() {
  return (
    <div className="flex items-center gap-3 text-ds-body-xs text-text-muted">
      <span className="h-px flex-1 bg-border-subtle" />
      {m.auth_or_continue_with()}
      <span className="h-px flex-1 bg-border-subtle" />
    </div>
  )
}
