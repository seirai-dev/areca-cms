import { createFileRoute, redirect } from '@tanstack/react-router'

/**
 * Legacy: `/orgs/$orgId/members`. Admins go to the client's People tab in
 * the Agency workspace; owners to People in the client's first site.
 */
export const Route = createFileRoute('/_app/orgs/$orgId/members')({
  beforeLoad: ({ context, params }) => {
    if (context.me.user.isAgencyAdmin) {
      throw redirect({
        to: '/agency/clients/$orgId',
        params: { orgId: params.orgId },
        search: { tab: 'people' },
        replace: true,
      })
    }
    const site = context.me.sites.find(
      (item) => item.organizationId === params.orgId,
    )
    if (site) {
      throw redirect({
        to: '/sites/$siteId/people',
        params: { siteId: site.id },
        replace: true,
      })
    }
    throw redirect({ to: '/', replace: true })
  },
})
