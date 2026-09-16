import { createFileRoute, redirect } from '@tanstack/react-router'

import { AuditLogList } from '#/components/admin/audit-log-list'
import { PageHeader } from '#/components/page-header'
import { m } from '#/paraglide/messages'

export const Route = createFileRoute('/_app/orgs/$orgId/audit')({
  beforeLoad: ({ context, params }) => {
    const isOwner = context.me.memberships.some(
      (membership) =>
        membership.organizationId === params.orgId &&
        membership.role === 'owner',
    )
    if (!isOwner) {
      throw redirect({ to: '/' })
    }
  },
  component: OrgAuditPage,
})

function OrgAuditPage() {
  const { orgId } = Route.useParams()
  const { me } = Route.useRouteContext()
  const membership = me.memberships.find(
    (item) => item.organizationId === orgId,
  )

  return (
    <div className="grid gap-6">
      <PageHeader
        title={m.admin_audit_activity_title()}
        description={
          membership
            ? m.admin_audit_activity_description({
                name: membership.organizationName,
              })
            : m.admin_audit_activity_description_fallback()
        }
      />
      <AuditLogList organizationId={orgId} />
    </div>
  )
}
