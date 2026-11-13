import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useRouterState } from '@tanstack/react-router'
import { LayoutGroup } from 'motion/react'
import {
  DotsThree,
  MagnifyingGlass,
  Plus,
  SidebarSimple,
  Sliders,
  SquaresFour,
  WarningCircle,
} from '@phosphor-icons/react'

import { queryKeys } from '#/lib/content/query-keys'
import { AccountMenu } from '#/components/shell/account-menu'
import { NavCount, NavGroupLabel, NavItem } from '#/components/shell/nav-item'
import { useShell } from '#/components/shell/shell-context'
import {
  AllSitesNav,
  WorkspaceSwitcher,
  sitesOverviewQueryOptions,
} from '#/components/shell/workspace-switcher'
import { Tag } from '#/components/ui/tag'
import { Button } from '#/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { KbdCombo, useModifierKey } from '#/components/ui/kbd'
import { Skeleton } from '#/components/ui/skeleton'
import { Hint } from '#/components/ui/tooltip'
import { SiteContentGroup } from '#/features/globals/site-content-nav'
import { GoLiveTray } from '#/features/golive/golive-tray'
import {
  agencyNavItems,
  canManageSite,
  collectionIcon,
  siteNavItems,
} from '#/lib/site-nav'
import { isDevSite } from '#/lib/site-environment'
import type { MeSite } from '#/lib/site-nav'
import type { Field } from '#/lib/types'
import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'
import { listCollectionsFn, listEntryCountsFn } from '#/server/fn/content'

export type SidebarCollection = {
  id: string
  key: string
  label: string
  routePattern: string
  enabled: boolean
  fields: Field[]
}

/** The current site's collections, as the sidebar and mobile sheet list them. */
export function useSiteCollections(
  siteId: string | undefined,
  isAdmin: boolean,
) {
  const query = useQuery({
    queryKey: queryKeys.collections(siteId ?? ''),
    queryFn: () => listCollectionsFn({ data: { siteId: siteId! } }),
    enabled: Boolean(siteId),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  })
  const all = (query.data ?? []) as SidebarCollection[]
  const visible = isAdmin ? all : all.filter((item) => item.enabled)
  const sorted = [...visible].sort(
    (a, b) =>
      Number(b.enabled) - Number(a.enabled) || a.label.localeCompare(b.label),
  )
  // One request counts every collection of the site. The server applies the
  // same visibility rule as `visible` above.
  const countsQuery = useQuery({
    queryKey: queryKeys.entryCounts(siteId ?? ''),
    queryFn: () => listEntryCountsFn({ data: { siteId: siteId! } }),
    enabled: Boolean(siteId),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  })
  return {
    collections: sorted,
    counts: sorted.map((collection) => countsQuery.data?.[collection.key]),
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    isRetrying: query.isFetching,
    refetch: () => void query.refetch(),
  }
}

/** Looks like a field; opens the command palette (test id `open-search`). */
function SearchField({ collapsed }: { collapsed: boolean }) {
  const { setPaletteOpen } = useShell()
  const modifier = useModifierKey()
  if (collapsed) {
    return (
      <Hint label={m.shell_search()} side="right">
        <button
          type="button"
          data-testid="open-search"
          aria-label={m.shell_search()}
          onClick={() => setPaletteOpen(true)}
          className="grid size-10 place-content-center rounded-[10px] text-icon-default outline-none transition-colors hover:bg-surface-state-hover hover:text-text-primary focus-visible:outline-2 focus-visible:outline-border-focus"
        >
          <MagnifyingGlass size={18} />
        </button>
      </Hint>
    )
  }
  return (
    <button
      type="button"
      data-testid="open-search"
      onClick={() => setPaletteOpen(true)}
      className="group/search flex h-9 w-full items-center gap-2 rounded-[10px] border border-border-default bg-background-surface px-2.5 text-left text-[14px] text-text-muted shadow-card outline-none transition-colors hover:border-border-strong hover:text-text-secondary focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-border-focus"
    >
      <MagnifyingGlass size={16} className="shrink-0" />
      <span className="flex-1">{m.shell_search()}</span>
      <KbdCombo keys={[modifier, 'K']} className="opacity-80" />
    </button>
  )
}

function ContentGroup({
  site,
  collapsed,
  onNavigate,
}: {
  site: MeSite
  collapsed: boolean
  onNavigate?: () => void
}) {
  const { me } = useShell()
  const isAdmin = me.user.isAgencyAdmin
  const { collections, counts, isLoading } = useSiteCollections(
    site.id,
    isAdmin,
  )
  const creatable = collections.filter((item) => item.enabled)

  return (
    <div className="grid gap-0.5">
      {collapsed ? (
        <div
          aria-hidden="true"
          className="mx-auto my-2 h-px w-6 bg-border-default"
        />
      ) : (
        <NavGroupLabel
          actions={
            <>
              {isAdmin ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="quiet"
                      size="icon-xs"
                      aria-label={m.shell_content_menu()}
                      data-testid="content-menu"
                      className="size-6"
                    >
                      <DotsThree weight="bold" className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" side="right">
                    <DropdownMenuItem asChild>
                      <Link
                        to="/sites/$siteId/settings"
                        params={{ siteId: site.id }}
                        search={{ tab: 'content' }}
                        onClick={onNavigate}
                      >
                        <Sliders />
                        {m.shell_edit_structure()}
                      </Link>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
              {creatable.length > 0 ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="quiet"
                      size="icon-xs"
                      aria-label={m.shell_new_menu()}
                      data-testid="new-menu"
                      className="size-6"
                    >
                      <Plus weight="bold" className="size-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="start"
                    side="right"
                    className="min-w-52"
                  >
                    <DropdownMenuLabel>{m.shell_new_menu()}</DropdownMenuLabel>
                    {creatable.map((collection) => {
                      const Icon = collectionIcon(
                        collection.key,
                        collection.label,
                      )
                      return (
                        <DropdownMenuItem key={collection.id} asChild>
                          <Link
                            to="/sites/$siteId/c/$collectionKey/new"
                            params={{
                              siteId: site.id,
                              collectionKey: collection.key,
                            }}
                            onClick={onNavigate}
                            data-testid={`new-${collection.key}`}
                          >
                            <Icon />
                            {collection.label}
                          </Link>
                        </DropdownMenuItem>
                      )
                    })}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
            </>
          }
        >
          {m.shell_nav_content()}
        </NavGroupLabel>
      )}
      {isLoading ? (
        collapsed ? null : (
          <div className="grid gap-1.5 px-2.5 py-1">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        )
      ) : collections.length === 0 ? (
        collapsed ? null : (
          <p className="px-2.5 py-1 text-[12.5px] leading-[18px] text-text-muted">
            {m.shell_no_content_types()}
          </p>
        )
      ) : (
        collections.map((collection, index) => (
          <NavItem
            key={collection.id}
            link={{
              to: '/sites/$siteId/c/$collectionKey',
              params: { siteId: site.id, collectionKey: collection.key },
            }}
            icon={collectionIcon(collection.key, collection.label)}
            label={collection.label}
            collapsed={collapsed}
            muted={!collection.enabled}
            testId={`collection-${collection.key}`}
            onNavigate={onNavigate}
            trailing={
              collection.enabled ? (
                <NavCount value={counts[index]} />
              ) : (
                <Tag tone="outline">{m.shell_collection_off()}</Tag>
              )
            }
          />
        ))
      )}
    </div>
  )
}

/** Site workspace navigation (desktop sidebar and mobile sheets share it). */
function SiteNav({
  site,
  collapsed = false,
  onNavigate,
  group = 'sidebar',
}: {
  site: MeSite
  collapsed?: boolean
  onNavigate?: () => void
  group?: string
}) {
  const { me } = useShell()
  const items = siteNavItems(me, site)
  const [overview, ...rest] = items
  return (
    <LayoutGroup id={group}>
      <nav
        aria-label={m.shell_site_navigation()}
        data-testid="site-nav"
        className={cn('grid gap-4', collapsed && 'justify-items-center gap-1')}
      >
        <div
          className={cn('grid gap-0.5', collapsed && 'justify-items-center')}
        >
          <NavItem
            link={{ to: overview.to, params: { siteId: site.id } }}
            icon={overview.icon}
            label={overview.label}
            exact
            collapsed={collapsed}
            testId={overview.testId}
            onNavigate={onNavigate}
            group={group}
          />
        </div>
        <ContentGroup
          site={site}
          collapsed={collapsed}
          onNavigate={onNavigate}
        />
        <SiteContentGroup
          site={site}
          collapsed={collapsed}
          onNavigate={onNavigate}
        />
        <div
          className={cn('grid gap-0.5', collapsed && 'justify-items-center')}
        >
          {collapsed ? (
            <div
              aria-hidden="true"
              className="mx-auto my-2 h-px w-6 bg-border-default"
            />
          ) : null}
          {rest.map((item) => (
            <NavItem
              key={item.key}
              link={{ to: item.to, params: { siteId: site.id } }}
              icon={item.icon}
              label={item.label}
              collapsed={collapsed}
              testId={item.testId}
              onNavigate={onNavigate}
              group={group}
            />
          ))}
        </div>
      </nav>
    </LayoutGroup>
  )
}

/** Agency workspace navigation. */
function AgencyNav({
  collapsed = false,
  onNavigate,
  group = 'sidebar-agency',
}: {
  collapsed?: boolean
  onNavigate?: () => void
  group?: string
}) {
  const items = agencyNavItems()
  const [overview, clients, ...rest] = items
  const [sitesOpen, setSitesOpen] = React.useState(true)
  return (
    <LayoutGroup id={group}>
      <nav
        aria-label={m.shell_agency_navigation()}
        data-testid="site-nav"
        data-workspace="agency"
        className={cn('grid gap-4', collapsed && 'justify-items-center gap-1')}
      >
        <div
          className={cn('grid gap-0.5', collapsed && 'justify-items-center')}
        >
          {[overview, clients].map((item) => (
            <NavItem
              key={item.key}
              link={{ to: item.to }}
              icon={item.icon}
              label={item.label}
              exact={item.exact}
              collapsed={collapsed}
              testId={item.testId}
              onNavigate={onNavigate}
              group={group}
            />
          ))}
        </div>
        {collapsed ? null : (
          <div className="grid min-w-0 gap-0.5">
            <NavGroupLabel
              actions={
                <Button
                  type="button"
                  variant="quiet"
                  size="icon-xs"
                  className="size-6"
                  aria-expanded={sitesOpen}
                  aria-label={m.shell_nav_all_sites()}
                  onClick={() => setSitesOpen((value) => !value)}
                >
                  <SquaresFour className="size-3.5" />
                </Button>
              }
            >
              {m.shell_nav_all_sites()}
            </NavGroupLabel>
            {sitesOpen ? (
              <AllSitesNav
                collapsed={collapsed}
                onNavigate={onNavigate}
                details
              />
            ) : null}
          </div>
        )}
        <div
          className={cn('grid gap-0.5', collapsed && 'justify-items-center')}
        >
          {rest.map((item) => (
            <NavItem
              key={item.key}
              link={{ to: item.to }}
              icon={item.icon}
              label={item.label}
              collapsed={collapsed}
              testId={item.testId}
              onNavigate={onNavigate}
              group={group}
            />
          ))}
        </div>
      </nav>
    </LayoutGroup>
  )
}

/** Sites whose newest build failed, from the (cached) sites overview. */
export function useFailedSites(sites: MeSite[], enabled: boolean) {
  const overview = useQuery({ ...sitesOverviewQueryOptions(), enabled })
  const failed = new Set(
    (overview.data?.sites ?? [])
      .filter((site) => site.lastBuildFailed)
      .map((site) => site.id),
  )
  return sites.filter((site) => failed.has(site.id))
}

/**
 * Agency "System" card: only when something needs attention, and not on the
 * Agency overview, whose own "Needs attention" section already lists it.
 */
function AttentionCard({ collapsed }: { collapsed: boolean }) {
  const { me } = useShell()
  const failed = useFailedSites(me.sites, true)
  const onOverview = useRouterState({
    select: (state) => state.location.pathname.replace(/\/$/, '') === '/agency',
  })
  if (failed.length === 0 || onOverview) return null
  const label =
    failed.length === 1
      ? m.shell_attention_failed_one({ site: failed[0].name })
      : m.shell_attention_failed_other({ count: failed.length })
  if (collapsed) {
    return (
      <Hint label={label} side="right">
        <Link
          to="/agency"
          aria-label={label}
          className="grid size-10 place-content-center rounded-[10px] text-icon-error hover:bg-surface-state-hover"
        >
          <WarningCircle weight="fill" size={18} />
        </Link>
      </Hint>
    )
  }
  return (
    <div
      data-testid="attention-card"
      className="grid gap-2 rounded-[14px] border border-border-default bg-background-surface p-3 shadow-card"
    >
      <span className="flex items-center gap-1.5 text-overline text-text-muted">
        {m.shell_system()}
      </span>
      <div className="flex items-start gap-2">
        <WarningCircle
          weight="fill"
          className="mt-0.5 size-4 shrink-0 text-icon-error"
        />
        <span className="text-[13px] leading-[18px] font-medium text-text-primary">
          {label}
        </span>
      </div>
      <div className="flex flex-wrap gap-1">
        {failed.slice(0, 3).map((site) => (
          <Link
            key={site.id}
            to="/sites/$siteId"
            params={{ siteId: site.id }}
            search={{ panel: 'golive' }}
            className="rounded-full bg-status-error-bg px-2 py-0.5 text-[11.5px] font-medium text-text-error hover:underline"
          >
            {site.name}
          </Link>
        ))}
      </div>
    </div>
  )
}

/**
 * The desktop sidebar (brief §2.1): 264px, fixed. Between 768 and 1023px it
 * can collapse to a 64px icon rail (remembered). Site workspace: workspace
 * card, search, Overview, CONTENT, Library, People, Settings, the Go‑live
 * tray, the account row. Agency: Overview, Clients, All sites, People,
 * Activity, Branding, and the System card.
 */
export function Sidebar({
  collapsed,
  canCollapse,
  onToggleCollapsed,
}: {
  collapsed: boolean
  canCollapse: boolean
  onToggleCollapsed: () => void
}) {
  const { me, mode, site } = useShell()
  const siteMode = mode === 'site' && site

  return (
    <aside
      data-testid="sidebar"
      data-collapsed={collapsed ? 'true' : 'false'}
      className={cn(
        'fixed inset-y-0 left-0 z-navbar hidden flex-col border-r border-border-default bg-sidebar md:flex',
        'transition-[width] duration-200 ease-(--ease-standard) motion-reduce:transition-none',
        collapsed
          ? 'w-(--sidebar-rail-width) items-center'
          : 'w-(--sidebar-width)',
      )}
    >
      <div className={cn('shrink-0 pt-3', collapsed ? 'px-2' : 'px-3')}>
        <WorkspaceSwitcher collapsed={collapsed} />
      </div>
      <div className={cn('shrink-0 pt-2 pb-3', collapsed ? 'px-2' : 'px-3')}>
        <SearchField collapsed={collapsed} />
      </div>
      <div
        className={cn(
          'scroll-quiet min-h-0 flex-1 overflow-y-auto pb-4',
          collapsed ? 'px-2' : 'px-3',
        )}
      >
        {siteMode ? (
          <SiteNav site={site} collapsed={collapsed} />
        ) : mode === 'agency' ? (
          <AgencyNav collapsed={collapsed} />
        ) : null}
      </div>
      <div
        className={cn(
          'grid shrink-0 gap-2 pb-3',
          collapsed ? 'justify-items-center px-2' : 'px-3',
        )}
      >
        {siteMode ? (
          // A development environment has no releases (Decision 7).
          isDevSite(site) ? null : (
            <GoLiveTray
              siteId={site.id}
              canPublish={canManageSite(me, site.organizationId)}
              canChangeMode={me.user.isAgencyAdmin}
              collapsed={collapsed}
            />
          )
        ) : mode === 'agency' ? (
          <AttentionCard collapsed={collapsed} />
        ) : null}
        <div
          className={cn(
            'flex items-center gap-1 border-t border-border-default pt-2',
            collapsed && 'flex-col',
          )}
        >
          <div className={cn('min-w-0', !collapsed && 'flex-1')}>
            <AccountMenu variant={collapsed ? 'rail' : 'row'} />
          </div>
          {canCollapse ? (
            <Hint
              label={
                collapsed
                  ? m.shell_expand_sidebar()
                  : m.shell_collapse_sidebar()
              }
              side="right"
            >
              <Button
                type="button"
                variant="quiet"
                size="icon-sm"
                onClick={onToggleCollapsed}
                aria-label={
                  collapsed
                    ? m.shell_expand_sidebar()
                    : m.shell_collapse_sidebar()
                }
                aria-pressed={!collapsed}
                data-testid="toggle-sidebar"
              >
                <SidebarSimple size={18} />
              </Button>
            </Hint>
          ) : null}
        </div>
      </div>
    </aside>
  )
}
