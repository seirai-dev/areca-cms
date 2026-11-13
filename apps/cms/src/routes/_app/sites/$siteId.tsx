import { Outlet, createFileRoute, notFound } from '@tanstack/react-router'

import { SiteNotFound, SiteWorkspace } from '#/features/shell/site-workspace'
import { sitePanelSearchSchema } from '#/features/shell/panel'
import { latestJobsQuery, releaseStatusQuery } from '#/features/golive/queries'
import { collectionsQuery, entryCountsQuery } from '#/lib/content/queries'
import { awaitOnServer, prefetchInBrowser } from '#/lib/route-prefetch'

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
  // Starts what every site page shows while the page's code loads, on hover
  // too (see lib/route-prefetch.ts). The sidebar's collections and counts are
  // rendered on the server; the release state shows relative times, so it
  // loads in the browser.
  loader: ({ context, params }) => {
    const { queryClient } = context
    prefetchInBrowser(
      () => queryClient.prefetchQuery(releaseStatusQuery(params.siteId)),
      () => queryClient.prefetchQuery(latestJobsQuery(params.siteId)),
    )
    return awaitOnServer(
      () => queryClient.prefetchQuery(collectionsQuery(params.siteId)),
      () => queryClient.prefetchQuery(entryCountsQuery(params.siteId)),
    )
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
