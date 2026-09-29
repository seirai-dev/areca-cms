import { createFileRoute } from '@tanstack/react-router'

import { AgencyPeopleScreen } from '#/features/agency/agency-people-screen'

/** `/agency/people`: everyone with an account, and agency access. */
export const Route = createFileRoute('/_app/agency/people')({
  component: AgencyPeoplePage,
})

function AgencyPeoplePage() {
  const { me } = Route.useRouteContext()
  return <AgencyPeopleScreen me={me} />
}
