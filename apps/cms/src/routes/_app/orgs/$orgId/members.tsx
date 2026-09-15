import { createFileRoute, redirect } from '@tanstack/react-router'

import { OrgMembers } from '#/components/admin/org-members'
import { PageHeader } from '#/components/page-header'

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
    <div className="grid gap-6">
      <PageHeader
        title="Team"
        description={
          membership
            ? `People who can work on ${membership.organizationName}.`
            : 'People who can work on this organization.'
        }
      />
      <OrgMembers organizationId={orgId} />
    </div>
  )
}
