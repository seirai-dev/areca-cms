import { createFileRoute, redirect } from '@tanstack/react-router'
import { z } from 'zod'

import { PeopleScreen } from '#/features/people/people-screen'
import { canManageSite } from '#/lib/site-nav'

/**
 * `/sites/$siteId/people?invite=1`: members and invitations (owners and
 * admins); `invite` opens the invite sheet (the palette's "Invite people").
 */
export const Route = createFileRoute('/_app/sites/$siteId/people')({
  validateSearch: z.object({
    invite: z.coerce.number().optional().catch(undefined),
  }),
  beforeLoad: ({ context, params }) => {
    if (!canManageSite(context.me, context.site.organizationId)) {
      throw redirect({
        to: '/sites/$siteId',
        params: { siteId: params.siteId },
      })
    }
  },
  component: PeoplePage,
})

function PeoplePage() {
  const { site, me } = Route.useRouteContext()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  return (
    <PeopleScreen
      site={site}
      me={me}
      inviteOpen={search.invite === 1}
      onInviteOpenChange={(open) =>
        void navigate({
          search: (prev) => ({ ...prev, invite: open ? 1 : undefined }),
          replace: true,
        })
      }
    />
  )
}
