import { createFileRoute } from '@tanstack/react-router'

import { AgencyOverviewScreen } from '#/features/agency/agency-overview-screen'

/** `/agency`: the first-run checklist and all-sites health. */
export const Route = createFileRoute('/_app/agency/')({
  component: AgencyOverviewPage,
})

function AgencyOverviewPage() {
  const { me } = Route.useRouteContext()
  return <AgencyOverviewScreen me={me} />
}
