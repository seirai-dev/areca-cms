import { ArrowLeft, Compass } from '@phosphor-icons/react'

import { buttonVariants } from '#/components/ui/button'
import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'
import { localizeHref } from '#/paraglide/runtime'

/**
 * 404 (brief §3.13): a centred card with a large quiet glyph, "This page
 * doesn't exist" / "Or you no longer have access to it.", the way back to
 * the workspace and a quiet "Go back". Plain links, so it also works outside
 * the router context (the root not-found renders before the app shell).
 */
export function NotFoundCard({ fullPage = false }: { fullPage?: boolean }) {
  return (
    <div
      data-testid="not-found"
      className={cn(
        'relative isolate flex items-center justify-center',
        fullPage
          ? 'min-h-svh overflow-hidden bg-background-default p-6'
          : 'min-h-[60vh] py-10',
      )}
    >
      {fullPage ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[420px] bg-[radial-gradient(50%_55%_at_50%_0%,var(--color-accent-soft),transparent_75%)] opacity-80"
        />
      ) : null}
      <div className="grid w-full max-w-[400px] animate-in justify-items-center gap-2 rounded-panel border border-border-default bg-background-surface px-8 pt-10 pb-8 text-center shadow-[0_1px_2px_rgb(0_0_0/0.04),0_24px_48px_-24px_rgb(0_0_0/0.12)] duration-200 fade-in-0 slide-in-from-bottom-1 motion-reduce:animate-none">
        <span
          aria-hidden="true"
          className="mb-4 grid size-20 place-content-center rounded-[24px] bg-background-subtle text-icon-muted ring-[10px] ring-background-subtle/50"
        >
          <Compass weight="duotone" className="size-10" />
        </span>
        <span className="text-overline text-text-muted tnum">404</span>
        <h1 className="text-title-1 text-balance text-text-primary">
          {m.shell_not_found_title()}
        </h1>
        <p className="text-body text-balance text-text-secondary">
          {m.shell_not_found_description()}
        </p>
        <div className="mt-6 grid w-full gap-2">
          <a
            href={localizeHref('/')}
            data-testid="not-found-home"
            className={buttonVariants({ size: 'lg', className: 'w-full' })}
          >
            {m.shell_not_found_back()}
          </a>
          <button
            type="button"
            onClick={() => window.history.back()}
            className={buttonVariants({
              variant: 'quiet',
              size: 'md',
              className: 'w-full',
            })}
          >
            <ArrowLeft />
            {m.shell_not_found_go_back()}
          </button>
        </div>
      </div>
    </div>
  )
}
