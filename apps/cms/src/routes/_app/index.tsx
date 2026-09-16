import { Link, createFileRoute } from '@tanstack/react-router'
import { ArrowUpRight, ChevronRight, LayoutGrid } from 'lucide-react'

import { EmptyState } from '#/components/empty-state'
import { GetStarted } from '#/components/get-started'
import { PageHeader } from '#/components/page-header'
import { Button } from '#/components/ui/button'
import { groupSitesByOrg } from '#/lib/site-nav'
import { m } from '#/paraglide/messages'

export const Route = createFileRoute('/_app/')({
  component: DashboardPage,
})

function DashboardPage() {
  const { me } = Route.useRouteContext()
  const groups = groupSitesByOrg(me.sites)
  const multiOrg = groups.length > 1

  return (
    <div className="grid gap-8">
      <PageHeader
        title={m.sites_dashboard_hello({
          name: me.user.name.split(' ')[0] || me.user.name,
        })}
        description={
          me.sites.length === 1
            ? m.sites_dashboard_one_site()
            : m.sites_dashboard_sites_count({ count: me.sites.length })
        }
        actions={
          me.user.isAgencyAdmin ? (
            <Button asChild variant="outline">
              <Link to="/admin/organizations">
                {m.sites_dashboard_manage_organizations()}
              </Link>
            </Button>
          ) : null
        }
      />
      {me.user.isAgencyAdmin && me.organizationCount === 0 ? (
        <GetStarted />
      ) : me.sites.length === 0 ? (
        <EmptyState
          icon={<LayoutGrid />}
          title={m.sites_dashboard_no_sites_title()}
          description={
            me.user.isAgencyAdmin
              ? m.sites_dashboard_no_sites_admin()
              : m.sites_dashboard_no_sites_member()
          }
          action={
            me.user.isAgencyAdmin ? (
              <Button asChild>
                <Link to="/admin/organizations">
                  {m.sites_dashboard_go_to_organizations()}
                </Link>
              </Button>
            ) : null
          }
        />
      ) : (
        <div className="grid gap-8">
          {groups.map((group) => (
            <section key={group.id} className="grid gap-1">
              <h2 className="text-lg">
                {multiOrg ? group.name : m.sites_dashboard_heading()}
              </h2>
              <ul className="divide-y border-y">
                {group.sites.map((site) => (
                  <li key={site.id} className="group relative">
                    <div className="flex items-center gap-4 py-3.5">
                      <div className="min-w-0 flex-1">
                        <Link
                          to="/sites/$siteId"
                          params={{ siteId: site.id }}
                          className="text-base font-medium text-foreground no-underline after:absolute after:inset-0 after:content-[''] hover:no-underline"
                        >
                          {site.name}
                        </Link>
                        <p className="text-sm text-muted-foreground">
                          {multiOrg
                            ? site.productionUrl.replace(/^https?:\/\//, '')
                            : m.sites_dashboard_org_url({
                                organization: site.organizationName,
                                url: site.productionUrl.replace(
                                  /^https?:\/\//,
                                  '',
                                ),
                              })}
                        </p>
                      </div>
                      <a
                        href={site.productionUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="relative z-10 hidden items-center gap-1 text-sm text-muted-foreground hover:text-foreground sm:inline-flex"
                        title={m.sites_open_live_site()}
                      >
                        {m.sites_live_site()}
                        <ArrowUpRight className="size-3.5" />
                      </a>
                      <ChevronRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
