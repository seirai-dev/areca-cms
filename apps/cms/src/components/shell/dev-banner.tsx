import { Link } from '@tanstack/react-router'
import { ArrowsClockwise, UploadSimple } from '@phosphor-icons/react'
import { toast } from 'sonner'

import { Button } from '#/components/ui/button'
import { Tag } from '#/components/ui/tag'
import { ResetDevEnvConfirm } from '#/features/dev-env/reset-confirm'
import { useDevSyncStatus } from '#/features/dev-env/use-push'
import { useDevEnvironment } from '#/features/site-settings/use-dev-environment'
import { findSite } from '#/lib/site-nav'
import type { MeSite } from '#/lib/site-nav'
import { m } from '#/paraglide/messages'
import type { Me } from '#/server/fn/me'

/**
 * Shown above the page of a development environment: where you are, that
 * changes stay here until pushed, a way back to the production site, the push
 * action, and (when production moved on) the reset notice.
 */
export function DevBanner({ me, site }: { me: Me; site: MeSite }) {
  const production = findSite(me, site.parentSiteId ?? undefined)
  const sync = useDevSyncStatus(site.id)
  const dev = useDevEnvironment(production?.id ?? site.id, false)
  const productionChanges = sync.data?.productionChanges ?? 0

  return (
    <div
      role="status"
      data-testid="dev-env-banner"
      className="mb-6 grid gap-2 rounded-card border border-border-default bg-accent-soft px-4 py-2.5 text-callout text-text-primary"
    >
      {/* Mobile: tag + text on row 1, actions on row 2. Desktop: one row. */}
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-3 sm:gap-y-2">
        <div className="flex min-w-0 flex-1 items-start gap-3 sm:items-center">
          <Tag tone="accent">{m.dev_env_tag()}</Tag>
          <p className="min-w-0 flex-1 break-words">
            {m.dev_env_banner({ name: production?.name ?? site.name })}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {production ? (
            <Link
              to="/sites/$siteId"
              params={{ siteId: production.id }}
              className="shrink-0 font-medium text-text-accent underline-offset-4 hover:underline"
              data-testid="dev-env-banner-production"
            >
              {m.dev_env_banner_back()}
            </Link>
          ) : null}
          <Button asChild size="sm" className="shrink-0">
            <Link
              to="/sites/$siteId/push"
              params={{ siteId: site.id }}
              data-testid="dev-env-push"
            >
              <UploadSimple />
              {m.dev_env_push_button()}
            </Link>
          </Button>
        </div>
      </div>

      {productionChanges > 0 ? (
        <div
          data-testid="dev-env-production-changed"
          className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border-default pt-2"
        >
          <p className="min-w-0 flex-1 break-words">
            {m.dev_env_production_changed({ count: productionChanges })}
          </p>
          <ResetDevEnvConfirm
            devSiteId={site.id}
            testId="dev-env-banner-reset-dialog"
            onConfirm={async () => {
              await dev.reset.mutateAsync(site.id)
              toast.success(m.dev_env_reset_done())
            }}
          >
            <Button
              type="button"
              variant="secondary"
              size="sm"
              loading={dev.reset.isPending}
              data-testid="dev-env-banner-reset"
            >
              {dev.reset.isPending ? null : <ArrowsClockwise />}
              {m.dev_env_reset()}
            </Button>
          </ResetDevEnvConfirm>
        </div>
      ) : null}
    </div>
  )
}
