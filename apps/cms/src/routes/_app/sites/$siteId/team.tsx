import { Link, createFileRoute, redirect } from '@tanstack/react-router'

import { OrgMembers } from '#/components/admin/org-members'
import { PageHeader } from '#/components/page-header'
import { canManageSite } from '#/lib/site-nav'
import { m } from '#/paraglide/messages'

export const Route = createFileRoute('/_app/sites/$siteId/team')({
  beforeLoad: ({ context }) => {
    if (!canManageSite(context.me, context.site.organizationId)) {
      throw redirect({ to: '/' })
    }
  },
  component: SiteTeamPage,
})

/**
 * Team for the site's organization, rendered inside the site frame so the
 * site tabs and the site switcher stay put. Membership itself is org-wide.
 */
function SiteTeamPage() {
  const { site, me } = Route.useRouteContext()

  return (
    <div className="grid gap-6">
      <PageHeader
        title={m.shell_nav_team()}
        description={m.sites_team_description({ org: site.organizationName })}
        actions={
          me.user.isAgencyAdmin ? (
            <Link
              to="/admin/organizations/$orgId"
              params={{ orgId: site.organizationId }}
              className="text-ds-body-sm underline underline-offset-4"
            >
              {m.sites_team_org_link()}
            </Link>
          ) : null
        }
      />
      <OrgMembers organizationId={site.organizationId} />
    </div>
  )
}
