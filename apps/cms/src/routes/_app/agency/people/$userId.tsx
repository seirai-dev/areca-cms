import { createFileRoute } from '@tanstack/react-router'

import { PersonScreen } from '#/features/agency/person/person-screen'

/** `/agency/people/$userId`: one person, their clients, security and danger zone. */
export const Route = createFileRoute('/_app/agency/people/$userId')({
  component: AgencyPersonPage,
})

function AgencyPersonPage() {
  const { me } = Route.useRouteContext()
  const { userId } = Route.useParams()
  return <PersonScreen me={me} userId={userId} />
}
