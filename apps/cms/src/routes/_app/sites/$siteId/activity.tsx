import { createFileRoute, redirect } from '@tanstack/react-router'

import { AuditLogList } from '#/components/admin/audit-log-list'
import { PageHeader } from '#/components/ui/page-header'
import { canManageSite } from '#/lib/site-nav'
import { m } from '#/paraglide/messages'

export const Route = createFileRoute('/_app/sites/$siteId/activity')({
  beforeLoad: ({ context }) => {
    if (!canManageSite(context.me, context.site.organizationId)) {
      throw redirect({ to: '/' })
    }
  },
  component: SiteActivityPage,
})

/** Organization audit log for the site's org, inside the site frame. */
function SiteActivityPage() {
  const { site } = Route.useRouteContext()

  return (
    <div className="grid gap-6">
      <PageHeader
        title={m.admin_audit_activity_title()}
        description={m.sites_activity_description({
          org: site.organizationName,
        })}
      />
      <AuditLogList organizationId={site.organizationId} />
    </div>
  )
}
