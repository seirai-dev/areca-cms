import type { ReactNode } from 'react'

import { LanguageSwitcher } from '#/components/language-switcher'
import { ThemeToggle } from '#/components/theme'
import { loginTaglineFor } from '#/lib/branding'
import { useBranding } from '#/lib/use-branding'
import { cn } from '#/lib/utils'
import { getLocale } from '#/paraglide/runtime'
import { m } from '#/paraglide/messages'

import { AuthArt } from './auth-art'

/**
 * Auth layout: one rounded panel on the canvas, the branded art on the left
 * (a short band on phones) and the form on the right, with the appearance and
 * language controls in the form's top-right corner. Every auth page (sign in,
 * setup, invitation, password reset, consent) uses it.
 */
export function AuthShell({
  children,
  footer,
}: {
  children: ReactNode
  footer?: ReactNode
}) {
  const branding = useBranding()
  const tagline =
    loginTaglineFor(branding, getLocale()) ?? m.auth_tagline_default()

  return (
    <div
      data-testid="auth-shell"
      className="relative isolate flex min-h-svh items-center justify-center overflow-hidden bg-background-default p-3 sm:p-6 lg:p-10"
    >
      {/* A faint wash of the accent behind the panel. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute top-[-30%] left-1/2 -z-10 size-[900px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,var(--color-accent-soft),transparent)] opacity-70 blur-3xl"
      />

      <div className="grid w-full max-w-[1040px] animate-in gap-2 rounded-[28px] border border-border-default bg-background-surface p-2 shadow-[0_1px_2px_rgb(0_0_0/0.04),0_40px_80px_-40px_rgb(0_0_0/0.35)] duration-200 fade-in-0 slide-in-from-bottom-1 motion-reduce:animate-none md:min-h-[640px] md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:p-2.5">
        <AuthArt
          branding={branding}
          tagline={tagline}
          compact
          className="h-[132px] md:hidden"
        />
        <AuthArt
          branding={branding}
          tagline={tagline}
          className="hidden md:block"
        />

        <div className="relative flex flex-col px-5 pt-14 pb-8 sm:px-10 md:px-12 md:pt-16 md:pb-12 lg:px-16">
          <div className="absolute top-3 right-3 flex items-center gap-0.5 md:top-4 md:right-4">
            <ThemeToggle />
            <LanguageSwitcher compact />
          </div>
          <main className="mx-auto my-auto grid w-full max-w-[400px] gap-6">
            {children}
            {footer ? (
              <div className="text-callout text-text-secondary">{footer}</div>
            ) : null}
          </main>
        </div>
      </div>
    </div>
  )
}

/** Title + one-line description at the top of the form. */
export function AuthHeading({
  title,
  description,
  className,
}: {
  title: ReactNode
  description?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('grid gap-2', className)}>
      <h1 className="text-display text-balance text-text-primary">{title}</h1>
      {description ? (
        <p className="text-body text-pretty text-text-secondary">
          {description}
        </p>
      ) : null}
    </div>
  )
}

/**
 * Inline error inside the card. Auth failures belong to the form, not to a
 * transient toast.
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
      className={cn(
        'flex items-start gap-2 rounded-control bg-status-error-bg px-3 py-2.5 text-callout text-text-error',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="mt-[5px] size-1.5 shrink-0 rounded-full bg-status-error"
      />
      <span className="min-w-0">{children}</span>
    </p>
  )
}

/**
 * A calm, neutral note at the top of the card: something happened that is not
 * an error (the account was deleted). Same shape as AuthError, no red.
 */
export function AuthNotice({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <p
      role="status"
      data-testid="auth-notice"
      className={cn(
        'flex items-start gap-2 rounded-control bg-background-subtle px-3 py-2.5 text-callout text-text-secondary',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="mt-[5px] size-1.5 shrink-0 rounded-full bg-icon-muted"
      />
      <span className="min-w-0">{children}</span>
    </p>
  )
}

/** Hairline "or" between the email form and the provider buttons. */
export function AuthDivider() {
  return (
    <div className="flex items-center gap-3 text-caption font-normal text-text-muted">
      <span aria-hidden="true" className="h-px flex-1 bg-border-default" />
      {m.auth_or()}
      <span aria-hidden="true" className="h-px flex-1 bg-border-default" />
    </div>
  )
}
