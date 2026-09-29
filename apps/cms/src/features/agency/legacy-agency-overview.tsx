// LEGACY (phase 1 bridge): replaced in phase 2
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { EmptyState } from '#/components/ui/empty-state'
import { GetStarted } from '#/components/get-started'
import {
  NeedsPublishing,
  RecentActivity,
  ScheduledEntries,
} from '#/components/home/activity-rail'
import { HomeSkeleton } from '#/components/home/home-skeleton'
import { ListPagination } from '#/components/list-pagination'
import { QueryError } from '#/components/ui/query-error'
import { SitesTable } from '#/components/sites-table'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import { m } from '#/paraglide/messages'
import type { Me } from '#/server/fn/me'
import { getHomeActivityFn } from '#/server/fn/home'
import { getSitesOverviewFn } from '#/server/fn/overview'
import { MagnifyingGlass, SquaresFour } from '@phosphor-icons/react'

const PAGE_SIZE = 25
const ALL_ORGS = 'all'

/**
 * Home: the sites you look after on the left, what needs your attention on
 * the right. An instance with no sites shows the first-run checklist instead.
 */
/** The old home page (sites, needs publishing, activity) as the Agency overview. */
export function LegacyAgencyOverview({ me }: { me: Me }) {
  const isAdmin = me.user.isAgencyAdmin
  const [search, setSearch] = useState('')
  const [organizationId, setOrganizationId] = useState(ALL_ORGS)
  const [offset, setOffset] = useState(0)

  const overviewQuery = useQuery({
    queryKey: ['sites-overview'],
    queryFn: () => getSitesOverviewFn(),
  })
  const activityQuery = useQuery({
    queryKey: ['home-activity'],
    queryFn: () => getHomeActivityFn(),
  })

  const sites = useMemo(
    () =>
      [...(overviewQuery.data?.sites ?? [])].sort(
        (a, b) =>
          new Date(b.lastUpdated).getTime() - new Date(a.lastUpdated).getTime(),
      ),
    [overviewQuery.data],
  )

  const organizations = useMemo(() => {
    const byId = new Map<string, string>()
    for (const site of sites)
      byId.set(site.organizationId, site.organizationName)
    return [...byId.entries()].map(([id, name]) => ({ id, name }))
  }, [sites])

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return sites.filter((site) => {
      if (
        organizationId !== ALL_ORGS &&
        site.organizationId !== organizationId
      ) {
        return false
      }
      if (!needle) return true
      return (
        site.name.toLowerCase().includes(needle) ||
        site.slug.toLowerCase().includes(needle)
      )
    })
  }, [sites, search, organizationId])

  const page = filtered.slice(offset, offset + PAGE_SIZE)

  if (overviewQuery.isError) {
    return (
      <QueryError
        title={m.home_load_error()}
        error={overviewQuery.error}
        onRetry={() => void overviewQuery.refetch()}
        retrying={overviewQuery.isFetching}
      />
    )
  }

  if (overviewQuery.isPending) {
    return <HomeSkeleton />
  }

  if (sites.length === 0) {
    return isAdmin || me.memberships.length > 0 ? (
      <GetStarted
        hasOrganization={overviewQuery.data.totals.organizations > 0}
        hasSite={false}
        hasCollection={false}
        isLive={false}
      />
    ) : (
      <EmptyState
        icon={<SquaresFour />}
        title={m.sites_dashboard_no_sites_title()}
        description={m.sites_dashboard_no_sites_member()}
      />
    )
  }

  return (
    <div className="grid gap-8 lg:grid-cols-12 lg:gap-10">
      <section className="grid min-w-0 content-start gap-4 lg:col-span-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-display">{m.home_sites_title()}</h1>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <MagnifyingGlass className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-icon-muted" />
              <Input
                type="search"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value)
                  setOffset(0)
                }}
                aria-label={m.home_search_sites()}
                placeholder={m.home_search_placeholder()}
                className="w-56 pl-9"
              />
            </div>
            {organizations.length > 1 ? (
              <Select
                value={organizationId}
                onValueChange={(value) => {
                  setOrganizationId(value)
                  setOffset(0)
                }}
              >
                <SelectTrigger aria-label={m.home_filter_organization()}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_ORGS}>
                    {m.home_all_organizations()}
                  </SelectItem>
                  {organizations.map((organization) => (
                    <SelectItem key={organization.id} value={organization.id}>
                      {organization.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
          </div>
        </div>

        <div className="grid gap-3" data-testid="sites-page">
          {filtered.length === 0 ? (
            <EmptyState
              icon={<MagnifyingGlass />}
              title={m.home_no_results_title()}
              description={m.home_no_results_description()}
              action={
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setSearch('')
                    setOrganizationId(ALL_ORGS)
                    setOffset(0)
                  }}
                >
                  {m.sites_clear_search()}
                </Button>
              }
            />
          ) : (
            <>
              <SitesTable
                sites={page}
                showOrganization={isAdmin && organizations.length > 1}
                isAgencyAdmin={isAdmin}
                caption={m.home_sites_title()}
              />
              <ListPagination
                offset={offset}
                limit={PAGE_SIZE}
                count={page.length}
                total={filtered.length}
                onChange={setOffset}
                noun={m.home_sites_noun()}
                nounSingular={m.home_site_noun()}
              />
            </>
          )}
        </div>
      </section>

      <aside className="flex flex-col gap-6 lg:col-span-4">
        <NeedsPublishing sites={sites} />
        {activityQuery.isError ? (
          <QueryError
            title={m.home_activity_load_error()}
            error={activityQuery.error}
            onRetry={() => void activityQuery.refetch()}
            retrying={activityQuery.isFetching}
          />
        ) : (
          <>
            <ScheduledEntries entries={activityQuery.data?.scheduled ?? []} />
            <RecentActivity rows={activityQuery.data?.activity ?? []} />
          </>
        )}
      </aside>
    </div>
  )
}
