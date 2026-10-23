import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import {
  ArrowLeft,
  Globe,
  MagnifyingGlass,
  Plus,
  Pulse,
} from '@phosphor-icons/react'

import { sitesOverviewQueryOptions } from '#/components/shell/workspace-switcher'
import { Button } from '#/components/ui/button'
import { EmptyState } from '#/components/ui/empty-state'
import { Input } from '#/components/ui/input'
import { QueryError } from '#/components/ui/query-error'
import { Skeleton } from '#/components/ui/skeleton'
import { Stagger, StaggerItem } from '#/components/ui/stagger'
import {
  Tabs,
  PersistentTabsContent as TabsContent,
  TabsList,
  TabsTrigger,
} from '#/components/ui/tabs'
import { useShell } from '#/components/shell/shell-context'
import { PeopleManager } from '#/features/people/people-manager'
import { TokenReveal } from '#/features/site-settings/token-reveal'
import {
  readPendingTokens,
  removePendingToken,
} from '#/lib/pending-site-tokens'
import type { PendingToken } from '#/lib/pending-site-tokens'
import { m } from '#/paraglide/messages'

import { ClientDeployment } from './client-deployment'
import { ClientSettings } from './client-settings'
import { ClientTile } from './client-tile'
import { clientCounts } from './clients-screen'
import { NewSiteSheet } from './new-site-sheet'
import { clientSitesQuery, clientsQuery } from './queries'
import type { ClientRow } from './queries'
import { AgencySiteCard } from './site-card'
import type { SiteFigures } from './site-card'

export const CLIENT_TABS = [
  'sites',
  'people',
  'deployment',
  'settings',
] as const
export type ClientTab = (typeof CLIENT_TABS)[number]

/**
 * `/agency/clients/$orgId` (brief §3.11): the client's name with its short
 * name as a whisper, and underline tabs Sites · People · Deployment ·
 * Settings (`?tab=`). `?new=1` opens the New site sheet directly.
 */
export function ClientScreen({
  orgId,
  tab,
  newSiteOpen,
  onTabChange,
  onNewSiteOpenChange,
}: {
  orgId: string
  tab: ClientTab
  newSiteOpen: boolean
  onTabChange: (tab: ClientTab) => void
  onNewSiteOpenChange: (open: boolean) => void
}) {
  const clients = useQuery(clientsQuery())
  const client = clients.data?.find((item) => item.id === orgId)

  if (clients.isError) {
    return (
      <QueryError
        title={m.agency_client_load_error()}
        error={clients.error}
        onRetry={() => void clients.refetch()}
        retrying={clients.isFetching}
      />
    )
  }

  if (clients.isPending) {
    return (
      <div className="grid gap-8" aria-busy="true">
        <div className="flex items-center gap-4">
          <Skeleton className="size-14 rounded-[15px]" />
          <div className="grid gap-2">
            <Skeleton className="h-8 w-56" />
            <Skeleton className="h-3.5 w-32" />
          </div>
        </div>
        <Skeleton className="h-11 w-full max-w-md" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Skeleton className="h-[180px] rounded-card" />
          <Skeleton className="h-[180px] rounded-card" />
        </div>
      </div>
    )
  }

  if (!client) {
    return (
      <EmptyState
        card
        tone="neutral"
        title={m.agency_client_not_found_title()}
        description={m.admin_org_not_found_description()}
        action={
          <Button asChild variant="secondary">
            <Link to="/agency/clients">{m.agency_back_to_clients()}</Link>
          </Button>
        }
      />
    )
  }

  return (
    <div
      className="grid gap-6"
      data-testid="organization-page"
      data-ready="true"
    >
      <header className="grid gap-4">
        <Link
          to="/agency/clients"
          className="inline-flex w-fit items-center gap-1 rounded-[6px] text-callout text-text-muted transition-colors hover:text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
        >
          <ArrowLeft className="size-3.5" />
          {m.shell_nav_clients()}
        </Link>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            <ClientTile id={client.id} name={client.name} size="xl" />
            <div className="grid min-w-0 gap-1">
              <h1 className="truncate text-display text-text-primary">
                {client.name}
              </h1>
              <p className="flex flex-wrap items-center gap-x-2 text-caption font-normal text-text-muted">
                <span className="font-mono" data-testid="client-slug">
                  {client.slug}
                </span>
                <span aria-hidden="true">·</span>
                <span>{clientCounts(client)}</span>
              </p>
            </div>
          </div>
          <Button
            asChild
            variant="secondary"
            size="sm"
            className="self-start sm:self-auto"
          >
            <Link
              to="/agency/activity"
              search={{ client: client.id }}
              data-testid="client-activity"
            >
              <Pulse />
              {m.agency_view_activity()}
            </Link>
          </Button>
        </div>
      </header>

      <Tabs
        value={tab}
        onValueChange={(value) => onTabChange(value as ClientTab)}
        className="gap-6"
      >
        <TabsList>
          <TabsTrigger value="sites" data-testid="client-tab-sites">
            {m.agency_client_tab_sites()}
          </TabsTrigger>
          <TabsTrigger value="people" data-testid="client-tab-people">
            {m.shell_nav_people()}
          </TabsTrigger>
          <TabsTrigger value="deployment" data-testid="client-tab-deployment">
            {m.settings_tab_deployment()}
          </TabsTrigger>
          <TabsTrigger value="settings" data-testid="client-tab-settings">
            {m.shell_nav_settings()}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="sites">
          <ClientSites
            client={client}
            newSiteOpen={newSiteOpen}
            onNewSiteOpenChange={onNewSiteOpenChange}
          />
        </TabsContent>
        <TabsContent value="people">
          <PeopleManager
            organizationId={client.id}
            organizationName={client.name}
          />
        </TabsContent>
        <TabsContent value="deployment">
          <ClientDeployment organizationId={client.id} />
        </TabsContent>
        <TabsContent value="settings">
          <ClientSettings
            client={client}
            onShowSites={() => onTabChange('sites')}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}

/* -------------------------------------------------------------------------
   Sites tab
------------------------------------------------------------------------- */

function ClientSites({
  client,
  newSiteOpen,
  onNewSiteOpenChange,
}: {
  client: ClientRow
  newSiteOpen: boolean
  onNewSiteOpenChange: (open: boolean) => void
}) {
  const { me } = useShell()
  const sites = useQuery(clientSitesQuery(client.id))
  const overview = useQuery(sitesOverviewQueryOptions())
  const [search, setSearch] = React.useState('')
  const [pending, setPending] = React.useState<PendingToken[]>([])

  // A token from an unconfirmed New site sheet (or a reload) stays visible.
  React.useEffect(() => {
    setPending(readPendingTokens(me.user.id, client.id))
  }, [me.user.id, client.id, newSiteOpen])

  const figures = React.useMemo(() => {
    const map = new Map<string, SiteFigures>()
    for (const row of overview.data?.sites ?? []) map.set(row.id, row)
    return map
  }, [overview.data])

  const rows = [...(sites.data ?? [])].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  )
  const needle = search.trim().toLowerCase()
  const visible = needle
    ? rows.filter((site) =>
        `${site.name} ${site.slug} ${site.productionUrl}`
          .toLowerCase()
          .includes(needle),
      )
    : rows
  const empty = sites.isSuccess && rows.length === 0

  const newSiteButton = (
    <Button
      type="button"
      data-testid="new-site"
      onClick={() => onNewSiteOpenChange(true)}
    >
      <Plus />
      {m.agency_new_site()}
    </Button>
  )

  return (
    <div className="grid gap-4">
      {!newSiteOpen
        ? pending.map((item) => (
            <div key={item.siteId} className="grid gap-2">
              {item.siteName ? (
                <p className="px-1 text-callout text-text-secondary">
                  {m.agency_pending_token({ site: item.siteName })}
                </p>
              ) : null}
              <TokenReveal token={item.token} />
              {item.schemaToken ? (
                <TokenReveal token={item.schemaToken} privilege="schema" />
              ) : null}
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  removePendingToken(me.user.id, client.id, item.siteId)
                  setPending(readPendingTokens(me.user.id, client.id))
                }}
              >
                {m.agency_token_saved()}
              </Button>
            </div>
          ))
        : null}

      {sites.isError ? (
        <QueryError
          title={m.agency_sites_load_error()}
          error={sites.error}
          onRetry={() => void sites.refetch()}
          retrying={sites.isFetching}
        />
      ) : sites.isPending ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Skeleton className="h-[180px] rounded-card" />
          <Skeleton className="h-[180px] rounded-card" />
        </div>
      ) : empty ? (
        <EmptyState
          card
          icon={<Globe weight="duotone" />}
          title={m.admin_org_sites_empty_title()}
          description={m.agency_client_sites_empty_body({
            client: client.name,
          })}
          action={newSiteButton}
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="relative w-full sm:max-w-xs">
              <MagnifyingGlass className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-icon-muted" />
              <Input
                type="search"
                data-testid="org-sites-search"
                aria-label={m.admin_org_sites_search()}
                placeholder={m.admin_org_sites_search()}
                className="pl-9"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                data-shortcut-search
              />
            </div>
            {newSiteButton}
          </div>
          {visible.length === 0 ? (
            <EmptyState
              size="sm"
              tone="neutral"
              icon={<MagnifyingGlass />}
              title={m.home_no_results_title()}
              action={
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setSearch('')}
                >
                  {m.sites_clear_search()}
                </Button>
              }
            />
          ) : (
            <Stagger className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {visible.map((site) => (
                <StaggerItem key={site.id}>
                  <AgencySiteCard
                    site={site}
                    figures={figures.get(site.id)}
                    loading={overview.isPending}
                    actions
                  />
                </StaggerItem>
              ))}
            </Stagger>
          )}
        </>
      )}

      <NewSiteSheet
        orgId={client.id}
        open={newSiteOpen}
        onOpenChange={onNewSiteOpenChange}
        onUnconfirmed={() =>
          setPending(readPendingTokens(me.user.id, client.id))
        }
      />
    </div>
  )
}
