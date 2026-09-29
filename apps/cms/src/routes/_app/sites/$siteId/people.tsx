import { createFileRoute, redirect } from '@tanstack/react-router'

import { LegacyPeople } from '#/features/people/legacy-people'
import { canManageSite } from '#/lib/site-nav'

/** `/sites/$siteId/people`: members and invitations (owners and admins). */
export const Route = createFileRoute('/_app/sites/$siteId/people')({
  beforeLoad: ({ context, params }) => {
    if (!canManageSite(context.me, context.site.organizationId)) {
      throw redirect({ to: '/sites/$siteId', params: { siteId: params.siteId } })
    }
  },
  component: PeoplePage,
})

function PeoplePage() {
  const { site, me } = Route.useRouteContext()
  return <LegacyPeople site={site} me={me} />
}
