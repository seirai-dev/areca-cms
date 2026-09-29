import { createFileRoute } from '@tanstack/react-router'

import { LegacyAgencyOverview } from '#/features/agency/legacy-agency-overview'

/** `/agency`: all-sites health and the first-run checklist. */
export const Route = createFileRoute('/_app/agency/')({
  component: AgencyOverviewPage,
})

function AgencyOverviewPage() {
  const { me } = Route.useRouteContext()
  return <LegacyAgencyOverview me={me} />
}
