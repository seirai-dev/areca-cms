import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import {
  Buildings,
  CaretUpDown,
  Check,
  Globe,
  Plus,
  SquaresFour,
  Translate,
} from '@phosphor-icons/react'

import { queryKeys } from '#/lib/query-keys'
import { BrandLogo } from '#/components/brand-mark'
import { useShell } from '#/components/shell/shell-context'
import { SiteTile } from '#/components/shell/site-tile'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandMeta,
  CommandSeparator,
} from '#/components/ui/command'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '#/components/ui/popover'
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '#/components/ui/hover-card'
import { Sheet, SheetContent, SheetTitle } from '#/components/ui/sheet'
import { Tag } from '#/components/ui/tag'
import { LiveDot } from '#/components/ui/status-pill'
import { useReleaseStatus } from '#/features/golive/use-release-status'
import { useRecentSites } from '#/features/shell/last-site'
import { useIsMobile } from '#/hooks/use-mobile'
import { useBranding } from '#/lib/use-branding'
import {
  displayHost,
  groupSitesByOrg,
  nestDevEnvironments,
} from '#/lib/site-nav'
import type { MeSite } from '#/lib/site-nav'
import { cn } from '#/lib/utils'
import { isDevSite } from '#/lib/site-environment'
import { m } from '#/paraglide/messages'
import { listOrganizationsFn } from '#/server/fn/admin'
import { getSitesOverviewFn } from '#/server/fn/overview'

export function sitesOverviewQueryOptions() {
  return {
    queryKey: queryKeys.sitesOverview(),
    queryFn: () => getSitesOverviewFn(),
    staleTime: 60_000,
  }
}

/** Live flags per site id, from the (cached) sites overview. */
function useSitesLive(enabled = true) {
  const query = useQuery({ ...sitesOverviewQueryOptions(), enabled })
  return React.useMemo(() => {
    const map = new Map<string, { live: boolean; pending: number }>()
    for (const row of query.data?.sites ?? []) {
      map.set(row.id, { live: row.live, pending: row.pendingEntries })
    }
    return map
  }, [query.data])
}

/* -------------------------------------------------------------------------
   The card at the top of the sidebar
------------------------------------------------------------------------- */

function SiteLiveLine({ site }: { site: MeSite }) {
  const release = useReleaseStatus(site.id)
  const host = displayHost(site.productionUrl)
  const live = Boolean(release.live)
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-[12px] leading-4 text-text-muted">
      <span className="truncate">{host}</span>
      {release.state === 'loading' ? null : (
        <>
          <span aria-hidden="true">·</span>
          {live ? (
            <span className="flex shrink-0 items-center gap-1 text-text-secondary">
              <LiveDot pulse="loop" />
              {m.shell_status_live()}
            </span>
          ) : (
            <span className="shrink-0">
              {isDevSite(site) ? m.dev_env_status() : m.shell_not_live_yet()}
            </span>
          )}
        </>
      )}
    </span>
  )
}

/**
 * Says where you are. Click = the workspace switcher. `compact` is the
 * mobile top-bar version; `collapsed` the tablet rail.
 */
const WorkspaceCard = React.forwardRef<
  HTMLButtonElement,
  React.ComponentProps<'button'> & {
    compact?: boolean
    collapsed?: boolean
    testId?: string
  }
>(function WorkspaceCardButton(
  {
    compact = false,
    collapsed = false,
    testId = 'sites-nav',
    className,
    ...props
  },
  ref,
) {
  const { mode, site } = useShell()
  const branding = useBranding()
  const inSite = mode !== 'agency' && site
  const title = inSite
    ? site.name
    : mode === 'agency'
      ? m.shell_agency()
      : branding.appName

  return (
    <button
      ref={ref}
      type="button"
      data-testid={testId}
      aria-label={m.shell_switcher_label({ name: title })}
      className={cn(
        'group/ws flex min-w-0 items-center gap-2.5 rounded-[12px] text-left outline-none transition-colors',
        'hover:bg-surface-state-hover focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-border-focus data-[state=open]:bg-surface-state-hover',
        compact
          ? 'h-10 max-w-[60vw] px-1.5'
          : collapsed
            ? 'size-11 justify-center'
            : 'w-full p-2',
        className,
      )}
      {...props}
    >
      {inSite ? (
        <SiteTile id={site.id} name={site.name} size={compact ? 'sm' : 'md'} />
      ) : (
        <BrandLogo branding={branding} size={compact ? 'sm' : 'md'} />
      )}
      {collapsed ? null : (
        <>
          <span className="grid min-w-0 flex-1 gap-px">
            <span className="truncate text-[14px] leading-5 font-semibold tracking-[-0.01em] text-text-primary">
              {title}
            </span>
            {compact ? null : inSite ? (
              <SiteLiveLine site={site} />
            ) : (
              <span className="truncate text-[12px] leading-4 text-text-muted">
                {mode === 'agency'
                  ? branding.appName
                  : m.shell_choose_workspace()}
              </span>
            )}
          </span>
          <CaretUpDown
            weight="bold"
            className="size-3.5 shrink-0 text-icon-muted transition-colors group-hover/ws:text-text-primary"
          />
        </>
      )}
    </button>
  )
})

/* -------------------------------------------------------------------------
   The switcher list
------------------------------------------------------------------------- */

function SwitcherList({ onDone }: { onDone: () => void }) {
  const { me, site: current, mode } = useShell()
  const navigate = useNavigate()
  const branding = useBranding()
  const liveMap = useSitesLive()
  const clients = useQuery({
    queryKey: queryKeys.organizations(),
    queryFn: () => listOrganizationsFn(),
    enabled: me.user.isAgencyAdmin,
  })
  const recent = useRecentSites()

  const recentSites = recent
    .map((id) => me.sites.find((site) => site.id === id))
    .filter((site): site is MeSite => Boolean(site))
    .slice(0, 3)
  // Dev envs are agency-only, so `nestDevEnvironments` only nests them for admins.
  const { topLevel, devByParent } = nestDevEnvironments(me.sites)
  const groups = groupSitesByOrg(topLevel)
  const isAdmin = me.user.isAgencyAdmin

  function go(siteId: string) {
    onDone()
    void navigate({ to: '/sites/$siteId', params: { siteId } })
  }

  const row = (site: MeSite, keyPrefix = '', nested = false) => {
    const state = liveMap.get(site.id)
    const selected = mode !== 'agency' && current?.id === site.id
    return (
      <CommandItem
        key={`${keyPrefix}${site.id}`}
        value={`${keyPrefix}${site.name} ${site.slug} ${site.organizationName} ${site.id}`}
        onSelect={() => go(site.id)}
        data-testid={`switch-site-${site.slug}`}
        className={cn(nested && 'pl-7')}
      >
        <SiteTile id={site.id} name={site.name} size="sm" />
        <span className="grid min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate font-medium">{site.name}</span>
            {nested ? <Tag tone="accent">{m.dev_env_tag()}</Tag> : null}
          </span>
          <span
            data-slot="command-meta"
            className="truncate text-[12px] leading-4 text-text-muted"
          >
            {displayHost(site.productionUrl)}
          </span>
        </span>
        {state?.live ? <LiveDot pulse="none" className="mr-1" /> : null}
        {selected ? <Check weight="bold" className="size-4" /> : null}
      </CommandItem>
    )
  }

  return (
    <Command loop className="rounded-card">
      {me.sites.length > 6 ? (
        <CommandInput placeholder={m.shell_switcher_search()} autoFocus />
      ) : null}
      <CommandList className="max-h-[min(70vh,460px)]">
        <CommandEmpty>{m.shell_switcher_empty()}</CommandEmpty>
        {recentSites.length > 1 && me.sites.length > 4 ? (
          <CommandGroup heading={m.shell_switcher_recent()}>
            {recentSites.map((site) => row(site, 'recent-'))}
          </CommandGroup>
        ) : null}
        {groups.map((group) => (
          <CommandGroup
            key={group.id}
            heading={
              groups.length > 1 || isAdmin
                ? group.name
                : m.shell_switcher_sites()
            }
          >
            {group.sites.map((site) => {
              const dev = devByParent.get(site.id)
              return (
                <React.Fragment key={site.id}>
                  {row(site)}
                  {dev ? row(dev, '', true) : null}
                </React.Fragment>
              )
            })}
          </CommandGroup>
        ))}
        {isAdmin ? (
          <>
            <CommandSeparator />
            <CommandGroup>
              <CommandItem
                value="agency workspace"
                data-testid="agency-nav"
                onSelect={() => {
                  onDone()
                  void navigate({ to: '/agency' })
                }}
              >
                <BrandLogo branding={branding} size="sm" />
                <span className="grid min-w-0 flex-1">
                  <span className="truncate font-medium">
                    {m.shell_agency()}
                  </span>
                  <span
                    data-slot="command-meta"
                    className="truncate text-[12px] leading-4 text-text-muted"
                  >
                    {m.shell_agency_description()}
                  </span>
                </span>
                {mode === 'agency' ? (
                  <Check weight="bold" className="size-4" />
                ) : null}
              </CommandItem>
            </CommandGroup>
          </>
        ) : null}
        <CommandSeparator />
        <CommandGroup>
          <CommandItem
            value="all sites"
            onSelect={() => {
              onDone()
              void navigate({ to: '/sites' })
            }}
          >
            <SquaresFour />
            {m.shell_nav_all_sites()}
            <CommandMeta className="tnum">{me.sites.length}</CommandMeta>
          </CommandItem>
          {isAdmin ? (
            <CommandItem
              value="new site"
              data-testid="switcher-new-site"
              onSelect={() => {
                onDone()
                // One client: straight into its New site sheet. Otherwise
                // pick the client first.
                const only =
                  clients.data?.length === 1 ? clients.data[0] : undefined
                void (only
                  ? navigate({
                      to: '/agency/clients/$orgId',
                      params: { orgId: only.id },
                      search: { new: 1 },
                    })
                  : navigate({ to: '/agency/clients' }))
              }}
            >
              <Plus />
              {m.shell_switcher_new_site_ellipsis()}
            </CommandItem>
          ) : null}
        </CommandGroup>
      </CommandList>
    </Command>
  )
}

/**
 * Workspace card + switcher. Popover on desktop, bottom sheet on mobile.
 * Controlled through the shell so `g s` can open it.
 */
export function WorkspaceSwitcher({
  compact = false,
  collapsed = false,
  className,
  testId,
}: {
  compact?: boolean
  collapsed?: boolean
  className?: string
  /** Defaults to `sites-nav`; the mobile top bar passes `sites-nav-mobile`. */
  testId?: string
}) {
  const shell = useShell()
  const mobile = useIsMobile()
  // Both the sidebar card and the mobile top-bar card are in the DOM (one is
  // hidden by CSS); only the visible one follows the shared open state.
  const active = compact ? mobile : !mobile
  const switcherOpen = active && shell.switcherOpen
  const setSwitcherOpen = active ? shell.setSwitcherOpen : () => {}

  if (mobile) {
    return (
      <>
        <WorkspaceCard
          compact={compact}
          testId={testId}
          className={className}
          aria-haspopup="dialog"
          aria-expanded={switcherOpen}
          data-state={switcherOpen ? 'open' : 'closed'}
          onClick={() => setSwitcherOpen(true)}
        />
        <Sheet open={switcherOpen} onOpenChange={setSwitcherOpen}>
          <SheetContent
            side="bottom"
            className="p-2 pt-0"
            showCloseButton={false}
          >
            <SheetTitle className="sr-only">
              {m.shell_switcher_title()}
            </SheetTitle>
            <SwitcherList onDone={() => setSwitcherOpen(false)} />
          </SheetContent>
        </Sheet>
      </>
    )
  }

  return (
    <Popover open={switcherOpen} onOpenChange={setSwitcherOpen}>
      <PopoverTrigger asChild>
        <WorkspaceCard
          compact={compact}
          collapsed={collapsed}
          className={className}
          testId={testId}
        />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side={collapsed ? 'right' : 'bottom'}
        sideOffset={collapsed ? 10 : 6}
        className="w-[320px] p-0"
        aria-label={m.shell_switcher_title()}
      >
        <SwitcherList onDone={() => setSwitcherOpen(false)} />
      </PopoverContent>
    </Popover>
  )
}

/**
 * Agency sidebar "All sites": every site with its live dot. Each production
 * site's development environment is nested under it with the Dev tag, as in
 * the switcher.
 */
export function AllSitesNav({
  collapsed,
  onNavigate,
  details = false,
}: {
  collapsed: boolean
  onNavigate?: () => void
  /** Show the full name and site details on hover (desktop sidebar only). */
  details?: boolean
}) {
  const { me } = useShell()
  const liveMap = useSitesLive()
  if (collapsed) return null
  const { topLevel, devByParent } = nestDevEnvironments(me.sites)
  const link = (site: MeSite, nested: boolean) => {
    const status = liveMap.get(site.id)
    const row = (
      <Link
        to="/sites/$siteId"
        params={{ siteId: site.id }}
        onClick={onNavigate}
        className={cn(
          'group/nav flex h-8 min-w-0 items-center gap-2.5 rounded-[8px] px-2.5 text-[14px] text-text-secondary outline-none transition-colors hover:bg-surface-state-hover hover:text-text-primary focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-border-focus',
          nested && 'pl-7',
        )}
      >
        <SiteTile id={site.id} name={site.name} size="xs" />
        <span className="min-w-0 flex-1 truncate">{site.name}</span>
        {nested ? <Tag tone="accent">{m.dev_env_tag()}</Tag> : null}
        {status?.live ? (
          <LiveDot pulse="none" />
        ) : (
          <span
            aria-hidden="true"
            className="size-2 shrink-0 rounded-full border-[1.5px] border-border-strong"
          />
        )}
      </Link>
    )
    if (!details) return row
    return (
      <HoverCard>
        <HoverCardTrigger asChild>{row}</HoverCardTrigger>
        <HoverCardContent side="right" align="start" sideOffset={10}>
          <SiteDetails site={site} status={status} />
        </HoverCardContent>
      </HoverCard>
    )
  }
  return (
    // minmax(0, 1fr): without it the grid track grows to the longest site
    // name and the rows overflow the sidebar instead of truncating.
    <ul
      className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-px"
      data-testid="agency-sites"
    >
      {topLevel.map((site) => {
        const dev = devByParent.get(site.id)
        return (
          <React.Fragment key={site.id}>
            <li className="min-w-0">{link(site, false)}</li>
            {dev ? <li className="min-w-0">{link(dev, true)}</li> : null}
          </React.Fragment>
        )
      })}
      {me.sites.length === 0 ? (
        <li className="px-2.5 py-1 text-callout text-text-muted">
          {m.shell_nav_no_sites()}
        </li>
      ) : null}
    </ul>
  )
}

/**
 * The sidebar hover card: full site and client name, address, status,
 * languages. Names and addresses can be one long unbroken string (a UUID, a
 * long host), so they wrap anywhere rather than push past the card edge.
 */
function SiteDetails({
  site,
  status,
}: {
  site: MeSite
  status: { live: boolean; pending: number } | undefined
}) {
  const host = displayHost(site.productionUrl)
  const dev = isDevSite(site)
  const languages = site.languages?.all ?? []
  return (
    <div
      className="grid grid-cols-[minmax(0,1fr)] gap-3"
      data-testid="site-hover-card"
    >
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-2.5">
        <SiteTile id={site.id} name={site.name} size="sm" />
        <div className="grid min-w-0 gap-0.5">
          <p className="text-[14px] leading-5 font-medium wrap-anywhere text-text-primary">
            {site.name}
          </p>
          <p className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-1.5 text-[12px] leading-4 text-text-muted">
            <Buildings aria-hidden="true" className="mt-px size-3.5" />
            <span className="wrap-anywhere">{site.organizationName}</span>
          </p>
        </div>
      </div>
      <div className="grid gap-1.5 border-t border-border-default pt-2.5 text-[12px] leading-4 text-text-secondary">
        {host ? (
          <DetailRow icon={<Globe aria-hidden="true" className="size-3.5" />}>
            <span className="font-mono wrap-anywhere">{host}</span>
          </DetailRow>
        ) : null}
        {status || dev ? (
          <DetailRow
            icon={
              status?.live ? (
                <LiveDot pulse="none" />
              ) : (
                <span
                  aria-hidden="true"
                  className="size-2 rounded-full border-[1.5px] border-border-strong"
                />
              )
            }
          >
            <span className="wrap-break-word">
              {dev
                ? m.dev_env_status()
                : status?.live
                  ? m.shell_status_live()
                  : m.shell_not_live_yet()}
              {status && status.pending > 0 && !dev ? (
                <span className="text-text-muted tnum">
                  {' · '}
                  {status.pending === 1
                    ? m.agency_changes_ready_one()
                    : m.agency_changes_ready_other({ count: status.pending })}
                </span>
              ) : null}
            </span>
          </DetailRow>
        ) : null}
        {languages.length > 1 ? (
          <DetailRow
            icon={<Translate aria-hidden="true" className="size-3.5" />}
          >
            <span className="font-mono uppercase wrap-anywhere">
              {languages.join(' · ')}
            </span>
          </DetailRow>
        ) : null}
      </div>
    </div>
  )
}

/** One icon + text line in the site hover card; the text wraps under itself. */
function DetailRow({
  icon,
  children,
}: {
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="grid grid-cols-[14px_minmax(0,1fr)] items-start gap-2">
      <span className="grid h-4 place-content-center text-icon-muted">
        {icon}
      </span>
      {children}
    </div>
  )
}
