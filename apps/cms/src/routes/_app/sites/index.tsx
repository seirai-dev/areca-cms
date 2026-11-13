import { createFileRoute } from '@tanstack/react-router'

import { SitePicker } from '#/features/sites/site-picker'
import { sitesOverviewQueryOptions } from '#/components/shell/workspace-switcher'

/** `/sites`: the site picker (brief §3.2). */
export const Route = createFileRoute('/_app/sites/')({
  // Started early, not awaited (see the site layout's loader).
  loader: ({ context }) => {
    void context.queryClient.prefetchQuery(sitesOverviewQueryOptions())
  },
  component: SitesPage,
})

function SitesPage() {
  const { me } = Route.useRouteContext()
  return <SitePicker me={me} />
}
