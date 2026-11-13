import { createFileRoute } from '@tanstack/react-router'

import { OverviewScreen } from '#/features/overview/overview-screen'
import { draftsByOthersQuery, recentEntriesQuery } from '#/lib/content/queries'
import { canManageSite } from '#/lib/site-nav'

/** `/sites/$siteId`: the site Overview (brief §3.3). */
export const Route = createFileRoute('/_app/sites/$siteId/')({
  // Started early, not awaited (see the site layout's loader).
  loader: ({ context }) => {
    const { queryClient, me, site } = context
    void queryClient.prefetchQuery(recentEntriesQuery(site.id))
    if (canManageSite(me, site.organizationId))
      void queryClient.prefetchQuery(draftsByOthersQuery(site.id))
  },
  component: OverviewPage,
})

function OverviewPage() {
  const { site } = Route.useRouteContext()
  return <OverviewScreen site={site} />
}
