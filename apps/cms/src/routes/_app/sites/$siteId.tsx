import { Outlet, createFileRoute, notFound } from '@tanstack/react-router'

import { SiteNotFound, SiteWorkspace } from '#/features/shell/site-workspace'
import { sitePanelSearchSchema } from '#/features/shell/panel'
import { latestJobsQuery, releaseStatusQuery } from '#/features/golive/queries'
import { collectionsQuery, entryCountsQuery } from '#/lib/content/queries'

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
  // Starts what every site page shows (sidebar, release state) while the
  // page's code loads, on hover too. Not awaited: the screens keep their own
  // loading states, and on the server the results stream to the browser.
  loader: ({ context, params }) => {
    const { queryClient } = context
    void queryClient.prefetchQuery(collectionsQuery(params.siteId))
    void queryClient.prefetchQuery(entryCountsQuery(params.siteId))
    void queryClient.prefetchQuery(releaseStatusQuery(params.siteId))
    void queryClient.prefetchQuery(latestJobsQuery(params.siteId))
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
