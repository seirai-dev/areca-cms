import { createFileRoute } from '@tanstack/react-router'

import { OverviewScreen } from '#/features/overview/overview-screen'

/** `/sites/$siteId`: the site Overview (brief §3.3). */
export const Route = createFileRoute('/_app/sites/$siteId/')({
  component: OverviewPage,
})

function OverviewPage() {
  const { site } = Route.useRouteContext()
  return <OverviewScreen site={site} />
}
