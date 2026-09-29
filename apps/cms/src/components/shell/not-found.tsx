import { Compass } from '@phosphor-icons/react'

import { Card } from '#/components/ui/card'
import { m } from '#/paraglide/messages'
import { localizeHref } from '#/paraglide/runtime'

/**
 * 404 (brief §3.13): a centred card with a large quiet glyph, "This page
 * doesn't exist", "or you no longer have access to it." and a way back to
 * the workspace. A plain link so it also works outside the router context.
 */
export function NotFoundCard({ fullPage = false }: { fullPage?: boolean }) {
  return (
    <div
      data-testid="not-found"
      className={
        fullPage
          ? 'flex min-h-svh items-center justify-center bg-background-default p-6'
          : 'flex min-h-[60vh] items-center justify-center py-10'
      }
    >
      <Card className="w-full max-w-[400px] items-center gap-2 px-8 py-10 text-center">
        <span
          aria-hidden="true"
          className="mb-3 grid size-16 place-content-center rounded-[20px] bg-background-subtle text-icon-muted"
        >
          <Compass weight="duotone" className="size-8" />
        </span>
        <h1 className="text-title-1 text-text-primary">{m.shell_not_found_title()}</h1>
        <p className="text-body text-text-secondary">{m.shell_not_found_description()}</p>
        <a
          href={localizeHref('/')}
          className="mt-5 inline-flex h-9 items-center rounded-control bg-action-primary px-4 text-[14px] font-medium text-action-primary-text transition-colors hover:bg-action-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
        >
          {m.shell_not_found_back()}
        </a>
      </Card>
    </div>
  )
}
