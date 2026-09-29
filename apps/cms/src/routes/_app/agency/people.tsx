import { createFileRoute } from '@tanstack/react-router'

import { LegacyAgencyPeople } from '#/features/agency/legacy-agency-people'

/** `/agency/people`: everyone with an account, and agency access. */
export const Route = createFileRoute('/_app/agency/people')({
  component: AgencyPeoplePage,
})

function AgencyPeoplePage() {
  const { me } = Route.useRouteContext()
  return <LegacyAgencyPeople me={me} />
}
