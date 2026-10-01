import { createFileRoute, redirect } from '@tanstack/react-router'

/**
 * Legacy: `/orgs/$orgId/audit`. Admins go to Agency activity filtered to the
 * client; owners to the Activity panel of the client's first site.
 */
export const Route = createFileRoute('/_app/orgs/$orgId/audit')({
  beforeLoad: ({ context, params }) => {
    if (context.me.user.isAgencyAdmin) {
      throw redirect({
        to: '/agency/activity',
        search: { client: params.orgId },
        replace: true,
      })
    }
    const site = context.me.sites.find(
      (item) => item.organizationId === params.orgId,
    )
    if (site) {
      throw redirect({
        to: '/sites/$siteId',
        params: { siteId: site.id },
        search: { panel: 'activity' },
        replace: true,
      })
    }
    throw redirect({ to: '/', replace: true })
  },
})
