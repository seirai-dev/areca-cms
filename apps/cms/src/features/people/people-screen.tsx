import * as React from 'react'
import { Link } from '@tanstack/react-router'
import { ArrowUpRight, UserPlus } from '@phosphor-icons/react'

import { Button } from '#/components/ui/button'
import { PageHeader } from '#/components/ui/page-header'
import type { MeSite } from '#/lib/site-nav'
import { m } from '#/paraglide/messages'
import type { Me } from '#/server/fn/me'

import { PeopleManager } from './people-manager'

/**
 * `/sites/$siteId/people` (brief §3.9): the client's people, with the page
 * header owning the one primary action, "Invite people". Admins also get a
 * quiet link to the client in the Agency workspace.
 */
export function PeopleScreen({ site, me }: { site: MeSite; me: Me }) {
  const [inviteOpen, setInviteOpen] = React.useState(false)
  return (
    <div className="grid gap-8" data-testid="people-page">
      <PageHeader
        title={m.shell_nav_people()}
        description={m.people_description({ client: site.organizationName })}
        meta={
          me.user.isAgencyAdmin ? (
            <Link
              to="/agency/clients/$orgId"
              params={{ orgId: site.organizationId }}
              search={{ tab: 'people' }}
              className="inline-flex items-center gap-0.5 text-callout font-medium text-text-accent hover:underline"
              data-testid="people-manage-in-agency"
            >
              {m.people_manage_in_agency({ client: site.organizationName })}
              <ArrowUpRight className="size-3.5" />
            </Link>
          ) : undefined
        }
        actions={
          <Button
            type="button"
            onClick={() => setInviteOpen(true)}
            data-testid="invite-member"
          >
            <UserPlus />
            {m.people_invite_people()}
          </Button>
        }
      />
      <PeopleManager
        organizationId={site.organizationId}
        organizationName={site.organizationName}
        inviteOpen={inviteOpen}
        onInviteOpenChange={setInviteOpen}
        showInviteButton={false}
      />
    </div>
  )
}
