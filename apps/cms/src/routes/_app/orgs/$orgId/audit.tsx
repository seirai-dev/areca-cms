import { createFileRoute, redirect } from '@tanstack/react-router'

import { AuditLogList } from '#/components/admin/audit-log-list'
import { PageHeader } from '#/components/page-header'

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
        title="Activity"
        description={
          membership
            ? `Everything that happened in ${membership.organizationName}.`
            : 'Everything that happened in this organization.'
        }
      />
      <AuditLogList organizationId={orgId} />
    </div>
  )
}
