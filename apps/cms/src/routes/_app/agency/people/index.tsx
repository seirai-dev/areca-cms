import { createFileRoute } from '@tanstack/react-router'
import { z } from '#/lib/zod'

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
    q: z.string().max(200).optional().catch(undefined),
    status: z.enum(STATUS_FILTERS).optional().catch(undefined),
    role: z.enum(ROLE_FILTERS).optional().catch(undefined),
    client: z.string().max(100).optional().catch(undefined),
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
