import { Link } from '@tanstack/react-router'
import { ArrowsClockwise, UploadSimple } from '@phosphor-icons/react'
import { toast } from 'sonner'

import { Button } from '#/components/ui/button'
import { ConfirmDialog } from '#/components/ui/confirm-dialog'
import { Tag } from '#/components/ui/tag'
import { useDevSyncStatus } from '#/features/dev-env/use-push'
import { resetDevEnvDescription } from '#/features/dev-env/reset-copy'
import { useDevEnvironment } from '#/features/site-settings/use-dev-environment'
import { errorMessage } from '#/lib/admin/helpers'
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
  const unpushed = sync.data?.unpushedChanges ?? 0
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
          <ConfirmDialog
            title={m.dev_env_reset_title()}
            description={resetDevEnvDescription(unpushed)}
            confirmLabel={m.dev_env_reset_confirm()}
            variant="destructive"
            testId="dev-env-banner-reset-dialog"
            onConfirm={async () => {
              try {
                await dev.reset.mutateAsync(site.id)
                toast.success(m.dev_env_reset_done())
              } catch (error) {
                toast.error(errorMessage(error))
              }
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
          </ConfirmDialog>
        </div>
      ) : null}
    </div>
  )
}
