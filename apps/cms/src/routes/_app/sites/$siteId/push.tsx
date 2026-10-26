import { createFileRoute, redirect } from '@tanstack/react-router'

import { PushScreen } from '#/features/dev-env/push-screen'
import { findSite } from '#/lib/site-nav'
import { isDevSite } from '#/lib/site-environment'

/**
 * `/sites/$siteId/push`: push a development environment into its production
 * site (docs/design/dev-environments.md, "Push screen"). Agency admins on a
 * dev env only; everyone else goes back to the site overview.
 */
export const Route = createFileRoute('/_app/sites/$siteId/push')({
  beforeLoad: ({ context, params }) => {
    if (!context.me.user.isAgencyAdmin || !isDevSite(context.site)) {
      throw redirect({
        to: '/sites/$siteId',
        params: { siteId: params.siteId },
      })
    }
  },
  component: PushPage,
})

function PushPage() {
  const { me, site } = Route.useRouteContext()
  const production = findSite(me, site.parentSiteId ?? undefined)
  return (
    <PushScreen
      devSite={site}
      productionName={production?.name ?? site.name}
      userId={me.user.id}
    />
  )
}
