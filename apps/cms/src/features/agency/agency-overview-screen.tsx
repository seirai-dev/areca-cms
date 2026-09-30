import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import {
  ArrowRight,
  CheckCircle,
  MagnifyingGlass,
  RocketLaunch,
  SquaresFour,
} from '@phosphor-icons/react'

import { useFailedSites } from '#/components/shell/sidebar'
import { SiteTile } from '#/components/shell/site-tile'
import { sitesOverviewQueryOptions } from '#/components/shell/workspace-switcher'
import { SystemAvatar, UserAvatar } from '#/components/ui/avatar'
import { Button } from '#/components/ui/button'
import { Card } from '#/components/ui/card'
import { EmptyState } from '#/components/ui/empty-state'
import { InsetList, InsetRow } from '#/components/ui/inset-list'
import { Input } from '#/components/ui/input'
import { PageHeader } from '#/components/ui/page-header'
import { QueryError } from '#/components/ui/query-error'
import { Skeleton } from '#/components/ui/skeleton'
import { Stagger, StaggerItem } from '#/components/ui/stagger'
import {
  ClockIcon,
  FailedIcon,
  formatScheduleShort,
} from '#/components/ui/status-pill'
import { RelativeTime, Timeline, TimelineItem } from '#/components/ui/timeline'
import { activitySentence } from '#/features/activity/activity-list'
import type { ActivityRow } from '#/features/activity/activity-list'
import { m } from '#/paraglide/messages'
import { getLocale } from '#/paraglide/runtime'
import type { Me } from '#/server/fn/me'

import { greeting, greetingName } from '#/features/overview/greeting'

import { GettingStarted } from './getting-started'
import { clientsQuery, homeActivityQuery } from './queries'
import { AgencySiteCard } from './site-card'

/** "Good morning, Kaan" by the viewer's clock (rendered after mount). */
function useGreeting(name: string) {
  const [hello, setHello] = React.useState<string | null>(null)
  React.useEffect(() => setHello(greeting(greetingName(name))), [name])
  return hello
}

function SectionHeading({
  id,
  children,
  action,
}: {
  id: string
  children: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <div className="flex min-h-7 items-center justify-between gap-3 px-1">
      <h2 id={id} className="text-overline text-text-muted">
        {children}
      </h2>
      {action}
    </div>
  )
}

/**
 * `/agency` (brief §3.11): the first-run checklist while the agency is not
 * set up yet, then what needs attention across every site, what's
 * scheduled, all sites as cards, and the latest activity.
 */
export function AgencyOverviewScreen({ me }: { me: Me }) {
  const hello = useGreeting(me.user.name)
  const overview = useQuery(sitesOverviewQueryOptions())
  const clients = useQuery(clientsQuery())

  const siteCount = overview.data?.sites.length ?? 0
  const clientCount =
    clients.data?.length ?? overview.data?.totals.organizations ?? 0

  return (
    <div className="grid gap-10" data-testid="agency-overview">
      <PageHeader
        title={
          <span className="inline-block min-h-[38px]">{hello ?? ' '}</span>
        }
        description={
          overview.isPending || clients.isPending ? (
            <Skeleton className="mt-1 h-4 w-56" />
          ) : (
            m.agency_overview_summary({
              sites: siteCount,
              clients: clientCount,
            })
          )
        }
      />

      <GettingStarted />

      {overview.isError ? (
        <QueryError
          title={m.agency_sites_load_error()}
          error={overview.error}
          onRetry={() => void overview.refetch()}
          retrying={overview.isFetching}
        />
      ) : (
        <>
          <NeedsAttention me={me} />
          <Scheduled />
          <SitesSection loading={overview.isPending} />
          <RecentActivity />
        </>
      )}
    </div>
  )
}

/* -------------------------------------------------------------------------
   Needs attention
------------------------------------------------------------------------- */

function NeedsAttention({ me }: { me: Me }) {
  const overview = useQuery(sitesOverviewQueryOptions())
  const failed = useFailedSites(me.sites, true)
  const failedIds = new Set(failed.map((site) => site.id))
  const ready = (overview.data?.sites ?? [])
    .filter((site) => site.pendingEntries > 0 && !failedIds.has(site.id))
    .sort((a, b) => b.pendingEntries - a.pendingEntries)

  if (overview.isPending) {
    return (
      <section className="grid gap-3">
        <SectionHeading id="agency-attention">
          {m.agency_needs_attention()}
        </SectionHeading>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <Skeleton className="h-[132px] rounded-card" />
          <Skeleton className="h-[132px] rounded-card" />
        </div>
      </section>
    )
  }

  const count = failed.length + ready.length

  return (
    <section
      className="grid gap-3"
      aria-labelledby="agency-attention"
      data-testid="needs-attention"
    >
      <SectionHeading id="agency-attention">
        {m.agency_needs_attention()}
      </SectionHeading>
      {count === 0 ? (
        <div className="flex items-center gap-3 rounded-card border border-dashed border-border-strong px-4 py-3.5 text-callout text-text-secondary">
          <CheckCircle
            weight="fill"
            className="size-5 shrink-0 text-icon-success"
          />
          {m.agency_nothing_needs_you()}
        </div>
      ) : (
        <Stagger className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {failed.map((site) => (
            <StaggerItem key={`failed-${site.id}`}>
              <Card
                className="h-full gap-3"
                data-testid={`attention-failed-${site.slug}`}
              >
                <div className="flex items-start gap-3">
                  <FailedIcon size={20} className="mt-0.5 text-icon-error" />
                  <div className="grid min-w-0 gap-0.5">
                    <p className="text-headline text-text-primary">
                      {m.overview_release_failed()}
                    </p>
                    <p className="truncate text-callout text-text-secondary">
                      {site.name}
                    </p>
                  </div>
                </div>
                <Button
                  asChild
                  variant="secondary"
                  size="sm"
                  className="mt-auto self-start"
                >
                  <Link
                    to="/sites/$siteId"
                    params={{ siteId: site.id }}
                    search={{ panel: 'golive' }}
                  >
                    {m.golive_see_what_happened()}
                  </Link>
                </Button>
              </Card>
            </StaggerItem>
          ))}
          {ready.map((site) => (
            <StaggerItem key={`ready-${site.id}`}>
              <Card
                className="h-full gap-3"
                data-testid={`attention-ready-${site.slug}`}
              >
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 grid size-5 shrink-0 place-content-center rounded-full bg-accent-soft">
                    <RocketLaunch
                      weight="fill"
                      className="size-3 text-icon-accent"
                    />
                  </span>
                  <div className="grid min-w-0 gap-0.5">
                    <p className="text-headline text-text-primary tnum">
                      {site.pendingEntries === 1
                        ? m.agency_changes_ready_one()
                        : m.agency_changes_ready_other({
                            count: site.pendingEntries,
                          })}
                    </p>
                    <p className="flex min-w-0 items-center gap-1.5 text-callout text-text-secondary">
                      <SiteTile id={site.id} name={site.name} size="xs" />
                      <span className="truncate">{site.name}</span>
                    </p>
                  </div>
                </div>
                <Button
                  asChild
                  variant="secondary"
                  size="sm"
                  className="mt-auto self-start"
                >
                  <Link
                    to="/sites/$siteId"
                    params={{ siteId: site.id }}
                    search={{ panel: 'golive' }}
                    data-testid={`attention-review-${site.slug}`}
                  >
                    {m.agency_review_and_go_live()}
                    <ArrowRight className="size-3.5" />
                  </Link>
                </Button>
              </Card>
            </StaggerItem>
          ))}
        </Stagger>
      )}
    </section>
  )
}

/* -------------------------------------------------------------------------
   Scheduled + recent activity
------------------------------------------------------------------------- */

function Scheduled() {
  const activity = useQuery(homeActivityQuery())
  const scheduled = activity.data?.scheduled ?? []
  if (scheduled.length === 0) return null
  return (
    <>
      <section
        className="grid content-start gap-3"
        aria-labelledby="agency-scheduled"
      >
        <SectionHeading id="agency-scheduled">
          {m.home_scheduled_title()}
        </SectionHeading>
        <InsetList data-testid="home-scheduled">
          {scheduled.map((item) => (
            <InsetRow
              key={item.id}
              asChild
              chevron
              leading={
                <span className="grid size-8 place-content-center rounded-[9px] bg-status-warning-bg">
                  <ClockIcon size={16} className="text-icon-warning" />
                </span>
              }
              title={item.title}
              subtitle={`${item.siteName} · ${item.collectionLabel}`}
              trailing={
                item.scheduledAt ? (
                  <span className="tnum">
                    {formatScheduleShort(item.scheduledAt, getLocale())}
                  </span>
                ) : null
              }
            >
              <Link
                to="/sites/$siteId/c/$collectionKey/$entryId"
                params={{
                  siteId: item.siteId,
                  collectionKey: item.collectionKey,
                  entryId: item.id,
                }}
              />
            </InsetRow>
          ))}
        </InsetList>
      </section>
    </>
  )
}

function RecentActivity() {
  const activity = useQuery(homeActivityQuery())
  if (activity.isError) {
    return (
      <QueryError
        title={m.agency_activity_load_error()}
        error={activity.error}
        onRetry={() => void activity.refetch()}
        retrying={activity.isFetching}
      />
    )
  }
  const rows = (activity.data?.activity ?? []) as unknown as ActivityRow[]
  return (
    <section
      className="grid content-start gap-3"
      aria-labelledby="agency-activity-recent"
    >
      <SectionHeading
        id="agency-activity-recent"
        action={
          <Button asChild variant="link" size="sm" className="text-callout">
            <Link to="/agency/activity" data-testid="agency-see-all-activity">
              {m.agency_see_all()}
            </Link>
          </Button>
        }
      >
        {m.activity_title()}
      </SectionHeading>
      <Card>
        {activity.isPending ? (
          <div className="grid gap-5" aria-busy="true">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="flex items-start gap-3">
                <Skeleton className="size-7 rounded-full" />
                <div className="grid flex-1 gap-2 pt-1">
                  <Skeleton className="h-3.5 w-2/3" />
                  <Skeleton className="h-3 w-1/3" />
                </div>
              </div>
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            size="sm"
            tone="neutral"
            title={m.activity_empty_title()}
            description={m.activity_empty_description()}
          />
        ) : (
          <Timeline
            data-testid="home-activity"
            style={
              {
                '--timeline-ring': 'var(--color-background-surface)',
              } as React.CSSProperties
            }
          >
            {rows.map((row) => {
              const { action, target } = activitySentence(row)
              const scope = [row.organizationName, row.siteName]
                .filter((part) => part && part !== target)
                .join(' · ')
              return (
                <TimelineItem
                  key={row.id}
                  tone="plain"
                  icon={
                    row.actorName ? (
                      <UserAvatar
                        name={row.actorName}
                        size="md"
                        className="size-7 text-[10.5px]"
                      />
                    ) : (
                      <SystemAvatar
                        size="md"
                        className="size-7"
                        label={m.activity_system()}
                      />
                    )
                  }
                  title={
                    <span>
                      <span className="text-text-primary">
                        {row.actorName ?? m.activity_system()}
                      </span>{' '}
                      <span className="font-normal text-text-secondary">
                        {action.charAt(0).toLocaleLowerCase(getLocale()) +
                          action.slice(1)}
                      </span>
                      {target ? (
                        <span className="text-text-primary"> {target}</span>
                      ) : null}
                    </span>
                  }
                  time={<RelativeTime value={row.createdAt} />}
                  meta={
                    scope ? (
                      <span className="text-caption font-normal text-text-muted">
                        {scope}
                      </span>
                    ) : undefined
                  }
                />
              )
            })}
          </Timeline>
        )}
      </Card>
    </section>
  )
}

/* -------------------------------------------------------------------------
   Sites
------------------------------------------------------------------------- */

function SitesSection({ loading }: { loading: boolean }) {
  const overview = useQuery(sitesOverviewQueryOptions())
  const [search, setSearch] = React.useState('')
  const all = overview.data?.sites ?? []
  const needle = search.trim().toLowerCase()
  const sites = needle
    ? all.filter((site) =>
        `${site.name} ${site.slug} ${site.organizationName} ${site.productionUrl}`
          .toLowerCase()
          .includes(needle),
      )
    : all

  return (
    <section
      className="grid gap-3"
      aria-labelledby="agency-sites"
      data-testid="sites-page"
    >
      <SectionHeading
        id="agency-sites"
        action={
          all.length > 6 ? (
            <div className="relative w-48 sm:w-60">
              <MagnifyingGlass className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-icon-muted" />
              <Input
                type="search"
                inputSize="sm"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={m.home_search_placeholder()}
                aria-label={m.home_search_sites()}
                className="pl-8"
                data-shortcut-search
              />
            </div>
          ) : (
            <Button asChild variant="link" size="sm" className="text-callout">
              <Link to="/agency/clients">{m.agency_all_clients()}</Link>
            </Button>
          )
        }
      >
        {loading
          ? m.agency_sites_heading_plain()
          : m.agency_sites_heading({ count: all.length })}
      </SectionHeading>
      {loading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-[132px] rounded-card" />
          ))}
        </div>
      ) : all.length === 0 ? (
        <EmptyState
          card
          size="sm"
          tone="neutral"
          icon={<SquaresFour weight="duotone" />}
          title={m.agency_no_sites_title()}
          description={m.agency_no_sites_body()}
        />
      ) : sites.length === 0 ? (
        <EmptyState
          size="sm"
          tone="neutral"
          icon={<MagnifyingGlass />}
          title={m.home_no_results_title()}
          action={
            <Button variant="secondary" size="sm" onClick={() => setSearch('')}>
              {m.sites_clear_search()}
            </Button>
          }
        />
      ) : (
        <Stagger className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {sites.map((site) => (
            <StaggerItem key={site.id}>
              <AgencySiteCard
                site={site}
                figures={site}
                loading={false}
                showClient
              />
            </StaggerItem>
          ))}
        </Stagger>
      )}
    </section>
  )
}
