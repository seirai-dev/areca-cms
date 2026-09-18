import { createFileRoute, redirect } from '@tanstack/react-router'

import { AuditLogList } from '#/components/admin/audit-log-list'
import { OrgFrame } from '#/components/admin/org-frame'
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
    <OrgFrame
      orgId={orgId}
      name={membership?.organizationName ?? m.shell_breadcrumb_organization()}
      slug={membership?.organizationSlug}
      active="audit"
    >
      <AuditLogList organizationId={orgId} />
    </OrgFrame>
  )
}
