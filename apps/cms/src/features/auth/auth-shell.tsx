import type { ReactNode } from 'react'

import { BrandLogo } from '#/components/brand-mark'
import { LanguageSwitcher } from '#/components/language-switcher'
import { ThemeToggle } from '#/components/theme'
import { useBranding } from '#/lib/use-branding'
import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'

/**
 * Auth layout (brief §3.1): a centred 400px card on the soft canvas, a very
 * subtle accent glow at the top, the brand logo tile above the card and a
 * small appearance + language control in the top-right corner.
 *
 * The app name is carried by each page's heading ("Sign in to Areca",
 * "Welcome to Areca"), so the lockup above the card is the tile alone, with
 * the name as its accessible label. `showName` adds the name under the tile
 * for pages whose heading doesn't say it (the invitation).
 */
export function AuthShell({
  children,
  footer,
  showName = false,
}: {
  children: ReactNode
  footer?: ReactNode
  showName?: boolean
}) {
  const branding = useBranding()

  return (
    <div
      data-testid="auth-shell"
      className="relative isolate flex min-h-svh flex-col overflow-hidden bg-background-default"
    >
      {/* The glow: two soft accent washes, strongest at the top centre. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[440px] bg-[radial-gradient(50%_55%_at_50%_0%,var(--color-accent-soft),transparent_75%)] opacity-80"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute top-[-220px] left-1/2 -z-10 size-[480px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,var(--color-accent-soft),transparent)] opacity-60 blur-3xl"
      />

      <div className="flex items-center justify-end gap-0.5 px-4 pt-4 sm:px-6">
        <ThemeToggle />
        <LanguageSwitcher compact />
      </div>

      <main className="flex flex-1 flex-col items-center justify-center px-4 pt-6 pb-16 sm:pb-24">
        {/* CSS enter (fade + 4px rise, 180ms) so it also plays on SSR-only
            renders such as the not-found card; off under reduced motion. */}
        <div className="grid w-full max-w-[400px] animate-in justify-items-center gap-7 duration-200 fade-in-0 slide-in-from-bottom-1 motion-reduce:animate-none">
          <div className="grid justify-items-center gap-2.5">
            <span
              role="img"
              aria-label={branding.appName}
              className="rounded-[14px] shadow-[0_8px_24px_-10px_color-mix(in_oklab,var(--color-accent)_60%,transparent)]"
            >
              <BrandLogo branding={branding} size="lg" />
            </span>
            {showName ? (
              <span className="text-headline text-text-primary">
                {branding.appName}
              </span>
            ) : null}
          </div>
          <div className="w-full rounded-panel border border-border-default bg-background-surface p-6 shadow-[0_1px_2px_rgb(0_0_0/0.04),0_24px_48px_-24px_rgb(0_0_0/0.12)] sm:p-8">
            {children}
          </div>
          {footer ? (
            <div className="text-center text-callout text-text-secondary">
              {footer}
            </div>
          ) : null}
        </div>
      </main>
    </div>
  )
}

/** Title + one-line description at the top of the card. */
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
    <div className={cn('grid gap-1.5 text-center', className)}>
      <h1 className="text-title-1 text-balance text-text-primary">{title}</h1>
      {description ? (
        <p className="text-body text-balance text-text-secondary">
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
