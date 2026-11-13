import { createFileRoute } from '@tanstack/react-router'
import { optionalParam, z } from '#/lib/search-params'

import { AgencyPeopleScreen } from '#/features/agency/agency-people-screen'
import {
  ALL_CLIENTS,
  ROLE_FILTERS,
  STATUS_FILTERS,
  parsePeopleFilters,
} from '#/features/agency/people-list'
import type { PeopleFilters } from '#/features/agency/people-list'

/**
 * `/agency/people?q=&status=&role=&client=`: everyone with an account and the
 * open invitations. Filters live in the URL so a filtered view can be linked.
 */
export const Route = createFileRoute('/_app/agency/people/')({
  validateSearch: z.object({
    q: optionalParam(z.string().check(z.maxLength(200))),
    status: optionalParam(z.enum(STATUS_FILTERS)),
    role: optionalParam(z.enum(ROLE_FILTERS)),
    client: optionalParam(z.string().check(z.maxLength(100))),
  }),
  component: AgencyPeoplePage,
})

function AgencyPeoplePage() {
  const { me } = Route.useRouteContext()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()

  function onFiltersChange(next: PeopleFilters) {
    void navigate({
      search: {
        q: next.search.trim() === '' ? undefined : next.search,
        status: next.status === 'all' ? undefined : next.status,
        role: next.role === 'all' ? undefined : next.role,
        client: next.clientId === ALL_CLIENTS ? undefined : next.clientId,
      },
      replace: true,
    })
  }

  return (
    <AgencyPeopleScreen
      me={me}
      filters={parsePeopleFilters(search)}
      onFiltersChange={onFiltersChange}
    />
  )
}
