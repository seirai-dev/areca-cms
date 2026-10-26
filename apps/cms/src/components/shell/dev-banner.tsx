import { Link } from '@tanstack/react-router'

import { Tag } from '#/components/ui/tag'
import { findSite } from '#/lib/site-nav'
import type { MeSite } from '#/lib/site-nav'
import { m } from '#/paraglide/messages'
import type { Me } from '#/server/fn/me'

/**
 * Shown above the page of a development environment: where you are, that
 * changes stay here until pushed, and a way back to the production site.
 * The push button comes with the push screen (a later step).
 */
export function DevBanner({ me, site }: { me: Me; site: MeSite }) {
  const production = findSite(me, site.parentSiteId ?? undefined)
  return (
    <div
      role="status"
      data-testid="dev-env-banner"
      className="flex flex-col gap-2 rounded-card border border-border-default bg-accent-soft px-4 py-2.5 text-callout text-text-primary sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-3 sm:gap-y-2"
    >
      {/* Mobile: tag and text share row 1. Desktop: `contents` flattens them into the banner row. */}
      <div className="flex min-w-0 items-start gap-3 sm:contents">
        <Tag tone="accent">{m.dev_env_tag()}</Tag>
        <p className="min-w-0 flex-1 break-words">
          {m.dev_env_banner({ name: production?.name ?? site.name })}
        </p>
      </div>
      {production ? (
        // Actions row (mobile row 2). New buttons, such as Push, go in this flex row.
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 sm:contents">
          <Link
            to="/sites/$siteId"
            params={{ siteId: production.id }}
            className="font-medium text-text-accent underline-offset-4 hover:underline sm:shrink-0"
            data-testid="dev-env-banner-production"
          >
            {m.dev_env_banner_back()}
          </Link>
        </div>
      ) : null}
    </div>
  )
}
