import * as React from 'react'
import { useRouter } from '@tanstack/react-router'
import type { ErrorComponentProps } from '@tanstack/react-router'
import { ArrowClockwise, WarningCircle } from '@phosphor-icons/react'

import { Button, buttonVariants } from '#/components/ui/button'
import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'
import { localizeHref } from '#/paraglide/runtime'

/**
 * Route-level error boundary (root `errorComponent`). Styled like the 404
 * card, localized, and offers Try again and a way home. The raw error
 * message (which can carry internal detail) is only shown in development;
 * production shows the friendly copy alone.
 */
export function RouteErrorCard({ error, reset }: ErrorComponentProps) {
  const router = useRouter()
  const [retrying, setRetrying] = React.useState(false)
  const detail = error instanceof Error ? error.message : ''

  const retry = async () => {
    setRetrying(true)
    try {
      reset()
      await router.invalidate()
    } finally {
      setRetrying(false)
    }
  }

  return (
    <div
      role="alert"
      data-testid="route-error"
      className="relative isolate flex min-h-svh items-center justify-center overflow-hidden bg-background-default p-6"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[420px] bg-[radial-gradient(50%_55%_at_50%_0%,var(--color-status-error-bg),transparent_75%)] opacity-80"
      />
      <div className="grid w-full max-w-[400px] animate-in justify-items-center gap-2 rounded-panel border border-border-default bg-background-surface px-8 pt-10 pb-8 text-center shadow-[0_1px_2px_rgb(0_0_0/0.04),0_24px_48px_-24px_rgb(0_0_0/0.12)] duration-200 fade-in-0 slide-in-from-bottom-1 motion-reduce:animate-none">
        <span
          aria-hidden="true"
          className="mb-4 grid size-20 place-content-center rounded-[24px] bg-status-error-bg text-icon-error ring-[10px] ring-status-error-bg/50"
        >
          <WarningCircle weight="duotone" className="size-10" />
        </span>
        <h1 className="text-title-1 text-balance text-text-primary">
          {m.shell_route_error_title()}
        </h1>
        <p className="text-body text-balance text-text-secondary">
          {m.shell_route_error_description()}
        </p>
        {import.meta.env.DEV && detail ? (
          <details className="mt-2 w-full text-left">
            <summary className="cursor-pointer text-caption text-text-muted">
              {m.shell_route_error_details()}
            </summary>
            <pre className="mt-2 max-h-40 overflow-auto rounded-[10px] bg-background-subtle p-3 text-mono text-text-secondary whitespace-pre-wrap break-words">
              {detail}
            </pre>
          </details>
        ) : null}
        <div className="mt-6 grid w-full gap-2">
          <Button
            type="button"
            size="lg"
            className="w-full"
            data-testid="route-error-retry"
            disabled={retrying}
            onClick={() => void retry()}
          >
            <ArrowClockwise className={cn(retrying && 'animate-spin')} />
            {retrying ? m.shared_retrying() : m.ui_try_again()}
          </Button>
          <a
            href={localizeHref('/')}
            data-testid="route-error-home"
            className={buttonVariants({
              variant: 'quiet',
              size: 'md',
              className: 'w-full',
            })}
          >
            {m.shell_route_error_home()}
          </a>
        </div>
      </div>
    </div>
  )
}
