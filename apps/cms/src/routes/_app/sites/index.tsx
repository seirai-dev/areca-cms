import { createFileRoute } from '@tanstack/react-router'

import { SitePicker } from '#/features/sites/site-picker'
import { sitesOverviewQueryOptions } from '#/components/shell/workspace-switcher'
import { prefetchInBrowser } from '#/lib/route-prefetch'

/** `/sites`: the site picker (brief §3.2). */
export const Route = createFileRoute('/_app/sites/')({
  // Started early (see lib/route-prefetch.ts).
  loader: ({ context }) =>
    prefetchInBrowser(() =>
      context.queryClient.prefetchQuery(sitesOverviewQueryOptions()),
    ),
  component: SitesPage,
})

function SitesPage() {
  const { me } = Route.useRouteContext()
  return <SitePicker me={me} />
}
