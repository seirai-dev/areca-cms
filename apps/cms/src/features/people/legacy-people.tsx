// LEGACY (phase 1 bridge): replaced in phase 2
import { Link } from '@tanstack/react-router'
import { ArrowUpRight } from '@phosphor-icons/react'

import { OrgMembers } from '#/components/admin/org-members'
import { PageHeader } from '#/components/ui/page-header'
import type { MeSite } from '#/lib/site-nav'
import { m } from '#/paraglide/messages'
import type { Me } from '#/server/fn/me'

/**
 * People for the site's client, until phase 2 rebuilds the screen. Members
 * belong to the client, so everyone here can open all of its sites.
 */
export function LegacyPeople({ site, me }: { site: MeSite; me: Me }) {
  return (
    <div className="grid gap-8">
      <PageHeader
        title={m.shell_nav_people()}
        description={m.people_description({ client: site.organizationName })}
        actions={
          me.user.isAgencyAdmin ? (
            <Link
              to="/agency/clients/$orgId"
              params={{ orgId: site.organizationId }}
              search={{ tab: 'people' }}
              className="inline-flex items-center gap-1 text-callout font-medium text-text-accent hover:underline"
            >
              {m.people_manage_in_agency({ client: site.organizationName })}
              <ArrowUpRight className="size-3.5" />
            </Link>
          ) : null
        }
      />
      <OrgMembers organizationId={site.organizationId} />
    </div>
  )
}
