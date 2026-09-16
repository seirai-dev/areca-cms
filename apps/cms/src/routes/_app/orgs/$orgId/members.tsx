import { createFileRoute, redirect } from '@tanstack/react-router'

import { OrgMembers } from '#/components/admin/org-members'
import { PageHeader } from '#/components/page-header'
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
    <div className="grid gap-6">
      <PageHeader
        title={m.admin_team_title()}
        description={
          membership
            ? m.admin_team_description({ name: membership.organizationName })
            : m.admin_team_description_fallback()
        }
      />
      <OrgMembers organizationId={orgId} />
    </div>
  )
}
