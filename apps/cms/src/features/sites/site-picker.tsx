import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import {
  ArrowRight,
  Buildings,
  MagnifyingGlass,
  Plus,
  SquaresFour,
} from '@phosphor-icons/react'

import { SiteTile } from '#/components/shell/site-tile'
import { sitesOverviewQueryOptions } from '#/components/shell/workspace-switcher'
import { Button } from '#/components/ui/button'
import { Card } from '#/components/ui/card'
import { EmptyState } from '#/components/ui/empty-state'
import { Input } from '#/components/ui/input'
import { PageHeader } from '#/components/ui/page-header'
import { QueryError } from '#/components/ui/query-error'
import { Skeleton } from '#/components/ui/skeleton'
import { Stagger, StaggerItem } from '#/components/ui/stagger'
import { StatusPill } from '#/components/ui/status-pill'
import { formatRelativeTime } from '#/lib/relative-time'
import { displayHost, groupSitesByOrg } from '#/lib/site-nav'
import type { MeSite } from '#/lib/site-nav'
import { isDevSite } from '#/lib/site-environment'
import { m } from '#/paraglide/messages'
import type { Me } from '#/server/fn/me'

type SiteFigures = {
  live: boolean
  pendingEntries: number
  lastUpdated: string | Date
}

/**
 * `/sites` (brief §3.2): a card grid of the sites you can open, grouped by
 * client for agency admins, with a "New site" card at the end for them.
 * Also the empty state for people without any site yet.
 */
export function SitePicker({ me }: { me: Me }) {
  const isAdmin = me.user.isAgencyAdmin
  const [search, setSearch] = React.useState('')
  const overview = useQuery(sitesOverviewQueryOptions())
  const figures = React.useMemo(() => {
    const map = new Map<string, SiteFigures>()
    for (const row of overview.data?.sites ?? []) map.set(row.id, row)
    return map
  }, [overview.data])

  const needle = search.trim().toLowerCase()
  const sites = needle
    ? me.sites.filter((site) =>
        `${site.name} ${site.slug} ${site.organizationName} ${site.productionUrl}`
          .toLowerCase()
          .includes(needle),
      )
    : me.sites
  const groups = isAdmin
    ? groupSitesByOrg(sites)
    : [{ id: 'all', name: '', sites }]

  if (me.sites.length === 0) {
    return (
      <div className="grid gap-8">
        <PageHeader title={m.sites_picker_title()} />
        <EmptyState
          card
          icon={<SquaresFour weight="duotone" />}
          title={m.sites_picker_empty_title()}
          description={
            isAdmin
              ? m.sites_picker_empty_admin()
              : m.sites_picker_empty_member()
          }
          action={
            isAdmin ? (
              <Button asChild>
                <Link to="/agency/clients">
                  <Plus />
                  {m.shell_switcher_new_site_ellipsis()}
                </Link>
              </Button>
            ) : null
          }
        />
      </div>
    )
  }

  return (
    <div className="grid gap-8" data-testid="sites-page">
      <PageHeader
        title={m.sites_picker_title()}
        description={m.sites_picker_description()}
        actions={
          <>
            {isAdmin ? (
              <Button asChild variant="secondary" data-testid="picker-agency">
                <Link to="/agency">
                  <Buildings />
                  {m.sites_picker_agency()}
                </Link>
              </Button>
            ) : null}
            {me.sites.length > 6 ? (
              <div className="relative w-full sm:w-64">
                <MagnifyingGlass className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-icon-muted" />
                <Input
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={m.shell_switcher_search()}
                  aria-label={m.shell_switcher_search()}
                  className="pl-9"
                  data-shortcut-search
                  data-testid="picker-search"
                />
              </div>
            ) : null}
          </>
        }
      />

      {overview.isError ? (
        <QueryError
          title={m.home_load_error()}
          error={overview.error}
          onRetry={() => void overview.refetch()}
          retrying={overview.isFetching}
        />
      ) : null}

      {sites.length === 0 ? (
        <EmptyState
          size="sm"
          icon={<MagnifyingGlass />}
          tone="neutral"
          title={m.home_no_results_title()}
        />
      ) : (
        groups.map((group) => (
          <section
            key={group.id}
            className="grid gap-3"
            data-testid={`picker-group-${group.id}`}
          >
            {group.name ? (
              <div className="flex items-center justify-between gap-3 px-1">
                <h2 className="text-overline text-text-muted">{group.name}</h2>
                {isAdmin ? (
                  <Link
                    to="/agency/clients/$orgId"
                    params={{ orgId: group.id }}
                    className="inline-flex items-center gap-1 text-caption text-text-muted transition-colors hover:text-text-primary"
                  >
                    {m.sites_picker_open_client()}
                    <ArrowRight className="size-3" />
                  </Link>
                ) : null}
              </div>
            ) : null}
            <Stagger className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {group.sites.map((site) => (
                <StaggerItem key={site.id}>
                  <SiteCard
                    site={site}
                    figures={figures.get(site.id)}
                    loading={overview.isPending}
                  />
                </StaggerItem>
              ))}
              {isAdmin && group.id !== 'all' ? (
                <StaggerItem>
                  <Link
                    to="/agency/clients/$orgId"
                    params={{ orgId: group.id }}
                    search={{ tab: 'sites', new: 1 }}
                    data-testid="picker-new-site"
                    className="flex h-full min-h-14 flex-row items-center justify-center gap-2 rounded-card sm:min-h-[132px] sm:flex-col border border-dashed border-border-strong text-callout font-medium text-text-secondary transition-colors hover:border-text-muted hover:bg-surface-state-hover hover:text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
                  >
                    <span className="grid size-9 place-content-center rounded-full bg-background-subtle">
                      <Plus className="size-4" />
                    </span>
                    {m.shell_switcher_new_site()}
                  </Link>
                </StaggerItem>
              ) : null}
            </Stagger>
          </section>
        ))
      )}
    </div>
  )
}

function SiteCard({
  site,
  figures,
  loading,
}: {
  site: MeSite
  figures: SiteFigures | undefined
  loading: boolean
}) {
  return (
    <Link
      to="/sites/$siteId"
      params={{ siteId: site.id }}
      data-testid={`site-card-${site.slug}`}
      className="block h-full rounded-card outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
    >
      <Card interactive className="h-full min-h-[132px] justify-between gap-5">
        <div className="flex items-start gap-3">
          <SiteTile id={site.id} name={site.name} size="lg" />
          <div className="grid min-w-0 flex-1 gap-0.5 pt-0.5">
            <span className="truncate text-headline text-text-primary">
              {site.name}
            </span>
            <span className="truncate text-callout text-text-muted">
              {displayHost(site.productionUrl)}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {loading || !figures ? (
            <Skeleton className="h-[22px] w-20 rounded-full" />
          ) : (
            <>
              {figures.live ? (
                <StatusPill
                  tone="success"
                  icon="live"
                  pulse="none"
                  label={m.shell_status_live()}
                />
              ) : (
                <StatusPill
                  tone="neutral"
                  label={
                    isDevSite(site)
                      ? m.dev_env_status()
                      : m.shell_not_live_yet()
                  }
                />
              )}
              {figures.pendingEntries > 0 ? (
                <StatusPill
                  tone="accent"
                  icon="dot"
                  label={m.golive_pill_ready({ count: figures.pendingEntries })}
                />
              ) : null}
              <span className="ml-auto text-caption font-normal text-text-muted">
                {m.sites_picker_updated({
                  time: formatRelativeTime(figures.lastUpdated),
                })}
              </span>
            </>
          )}
        </div>
      </Card>
    </Link>
  )
}
