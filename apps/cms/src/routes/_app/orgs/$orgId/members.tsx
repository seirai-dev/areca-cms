import { createFileRoute, redirect } from '@tanstack/react-router'

import { OrgMembers } from '#/components/admin/org-members'
import { OrgFrame } from '#/components/admin/org-frame'
import { m } from '#/paraglide/messages'

export const Route = createFileRoute('/_app/orgs/$orgId/members')({
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
  component: OrgMembersPage,
})

function OrgMembersPage() {
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
      active="members"
    >
      <OrgMembers organizationId={orgId} />
    </OrgFrame>
  )
}
