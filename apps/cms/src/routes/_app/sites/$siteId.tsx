import { Outlet, createFileRoute, notFound } from '@tanstack/react-router'

import { SiteNotFound, SiteWorkspace } from '#/features/shell/site-workspace'
import { sitePanelSearchSchema } from '#/features/shell/panel'

/**
 * Site workspace layout. Validates access against `me.sites` and owns the
 * overlay search params (`?panel=golive|activity`, `release`) shared by every
 * `/sites/$siteId/**` route.
 */
export const Route = createFileRoute('/_app/sites/$siteId')({
  validateSearch: sitePanelSearchSchema,
  beforeLoad: ({ context, params }) => {
    const site = context.me.sites.find((item) => item.id === params.siteId)
    if (!site) {
      throw notFound()
    }
    return { site }
  },
  notFoundComponent: SiteNotFound,
  component: SiteLayout,
})

function SiteLayout() {
  const { site } = Route.useRouteContext()
  return (
    <SiteWorkspace siteId={site.id}>
      <Outlet />
    </SiteWorkspace>
  )
}
