import { createFileRoute } from '@tanstack/react-router'

import { OverviewScreen } from '#/features/overview/overview-screen'
import { draftsByOthersQuery, recentEntriesQuery } from '#/lib/content/queries'
import { canManageSite } from '#/lib/site-nav'
import { prefetchInBrowser } from '#/lib/route-prefetch'

/** `/sites/$siteId`: the site Overview (brief §3.3). */
export const Route = createFileRoute('/_app/sites/$siteId/')({
  // Started early (see lib/route-prefetch.ts).
  loader: ({ context }) => {
    const { queryClient, me, site } = context
    prefetchInBrowser(
      () => queryClient.prefetchQuery(recentEntriesQuery(site.id)),
      () =>
        canManageSite(me, site.organizationId) &&
        queryClient.prefetchQuery(draftsByOthersQuery(site.id)),
    )
  },
  component: OverviewPage,
})

function OverviewPage() {
  const { site } = Route.useRouteContext()
  return <OverviewScreen site={site} />
}
