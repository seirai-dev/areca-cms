import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useRouterState } from '@tanstack/react-router'
import {
  Building2,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  ClipboardList,
  LayoutGrid,
  LogOut,
  Palette,
  Users,
} from 'lucide-react'

import { BrandMark } from '#/components/brand-mark'
import { queryKeys } from '#/components/editor/query-keys'
import { Avatar, AvatarFallback } from '#/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
  useSidebar,
} from '#/components/ui/sidebar'
import { authClient } from '#/lib/auth-client'
import {
  findSite,
  groupSitesByOrg,
  isSectionActive,
  siteIdFromPath,
  siteSections,
} from '#/lib/site-nav'
import type { MeSite } from '#/lib/site-nav'
import { listCollectionsFn } from '#/server/fn/content'
import type { Me } from '#/server/fn/me'

const COLLAPSED_ORG_IDS_KEY = 'areca.sidebar.collapsedOrgIds'

function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join('') || 'U'
  )
}

function readCollapsedOrgIds(): Set<string> {
  try {
    const raw = localStorage.getItem(COLLAPSED_ORG_IDS_KEY)
    if (!raw) return new Set()
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter((id): id is string => typeof id === 'string'))
  } catch {
    return new Set()
  }
}

function writeCollapsedOrgIds(ids: Set<string>) {
  try {
    localStorage.setItem(COLLAPSED_ORG_IDS_KEY, JSON.stringify([...ids]))
  } catch {
    /* localStorage may be unavailable */
  }
}

export function AppSidebar({ me }: { me: Me }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const { isMobile, setOpenMobile } = useSidebar()
  const [ready, setReady] = useState(false)
  const [collapsedOrgIds, setCollapsedOrgIds] = useState(new Set<string>())

  useEffect(() => {
    setReady(true)
    setCollapsedOrgIds(readCollapsedOrgIds())
  }, [])

  // Close the mobile sheet after any navigation.
  useEffect(() => {
    if (isMobile) setOpenMobile(false)
  }, [pathname, isMobile, setOpenMobile])

  const currentSite = findSite(me, siteIdFromPath(pathname))
  const currentSiteOrgId = currentSite?.organizationId
  const orgGroups = groupSitesByOrg(me.sites)
  const multiOrg = orgGroups.length > 1

  function toggleOrgCollapsed(orgId: string) {
    setCollapsedOrgIds((current) => {
      const next = new Set(current)
      if (next.has(orgId)) next.delete(orgId)
      else next.add(orgId)
      writeCollapsedOrgIds(next)
      return next
    })
  }

  async function signOut() {
    try {
      await authClient.signOut()
    } finally {
      window.location.assign('/login')
    }
  }

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild tooltip="Dashboard">
              <Link to="/">
                <BrandMark />
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          {currentSite ? (
            <SidebarMenuItem>
              <SiteSwitcher me={me} current={currentSite} />
            </SidebarMenuItem>
          ) : null}
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {currentSite ? (
          <SiteSectionsGroup me={me} site={currentSite} pathname={pathname} />
        ) : (
          <div data-testid="sites-nav">
            {orgGroups.length === 0 ? (
              <SidebarGroup>
                <SidebarGroupLabel>Sites</SidebarGroupLabel>
                <SidebarGroupContent>
                  <p className="px-2 text-xs text-muted-foreground">
                    No sites yet.
                  </p>
                </SidebarGroupContent>
              </SidebarGroup>
            ) : (
              orgGroups.map((group) => {
                const expanded =
                  currentSiteOrgId === group.id ||
                  !collapsedOrgIds.has(group.id)
                return (
                  <OrgSitesGroup
                    key={group.id}
                    group={group}
                    multiOrg={multiOrg}
                    pathname={pathname}
                    expanded={expanded}
                    onToggle={() => toggleOrgCollapsed(group.id)}
                  />
                )
              })
            )}
          </div>
        )}

        {me.user.isAgencyAdmin ? (
          <SidebarGroup data-testid="agency-nav">
            <SidebarGroupLabel>Agency</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    isActive={pathname.startsWith('/admin/organizations')}
                    tooltip="Organizations"
                  >
                    <Link to="/admin/organizations">
                      <Building2 />
                      <span>Organizations</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    isActive={pathname.startsWith('/admin/users')}
                    tooltip="Users"
                  >
                    <Link to="/admin/users">
                      <Users />
                      <span>Users</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    isActive={pathname.startsWith('/admin/audit')}
                    tooltip="Audit log"
                  >
                    <Link to="/admin/audit">
                      <ClipboardList />
                      <span>Audit log</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    isActive={pathname.startsWith('/admin/branding')}
                    tooltip="Branding"
                  >
                    <Link to="/admin/branding" data-testid="branding-nav">
                      <Palette />
                      <span>Branding</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ) : null}
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              asChild
              tooltip={`${me.user.name} · ${me.user.email}`}
              className="cursor-default hover:bg-transparent"
            >
              <div data-testid="user-menu">
                <Avatar className="size-8">
                  <AvatarFallback>{initials(me.user.name)}</AvatarFallback>
                </Avatar>
                <div className="grid min-w-0 flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">{me.user.name}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {me.user.email}
                  </span>
                </div>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              data-testid="sign-out"
              tooltip="Sign out"
              disabled={!ready}
              onClick={() => void signOut()}
            >
              <LogOut />
              <span>Sign out</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}

function OrgSitesGroup({
  group,
  multiOrg,
  pathname,
  expanded,
  onToggle,
}: {
  group: { id: string; name: string; sites: MeSite[] }
  multiOrg: boolean
  pathname: string
  expanded: boolean
  onToggle: () => void
}) {
  const Chevron = expanded ? ChevronDown : ChevronRight

  return (
    <SidebarGroup>
      <SidebarGroupLabel asChild>
        <button
          type="button"
          aria-expanded={expanded}
          title={group.name}
          className="w-full cursor-pointer"
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            onToggle()
          }}
        >
          <span className="truncate">{multiOrg ? group.name : 'Sites'}</span>
          <Chevron className="ml-auto" />
        </button>
      </SidebarGroupLabel>
      {expanded ? (
        <SidebarGroupContent>
          <SidebarMenu>
            {group.sites.map((site) => (
              <SidebarMenuItem key={site.id}>
                <SidebarMenuButton
                  asChild
                  isActive={pathname.startsWith(`/sites/${site.id}`)}
                  tooltip={site.name}
                >
                  <Link to="/sites/$siteId" params={{ siteId: site.id }}>
                    <LayoutGrid />
                    <span>{site.name}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroupContent>
      ) : null}
    </SidebarGroup>
  )
}

function SiteSwitcher({ me, current }: { me: Me; current: MeSite }) {
  const groups = groupSitesByOrg(me.sites)
  const multiOrg = groups.length > 1

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <SidebarMenuButton
          size="lg"
          tooltip={`Site: ${current.name}`}
          className="data-[state=open]:bg-sidebar-accent"
          data-testid="site-switcher"
        >
          <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-secondary text-secondary-foreground">
            <LayoutGrid className="size-4" />
          </div>
          <div className="grid min-w-0 flex-1 text-left text-sm leading-tight">
            <span className="truncate font-medium">{current.name}</span>
            <span className="truncate text-xs text-muted-foreground">
              {current.organizationName}
            </span>
          </div>
          <ChevronsUpDown className="ml-auto size-4 opacity-60" />
        </SidebarMenuButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        side="bottom"
        className="w-(--radix-dropdown-menu-trigger-width) min-w-56"
      >
        {groups.map((group) => (
          <DropdownMenuGroup key={group.id}>
            {multiOrg ? (
              <DropdownMenuLabel className="text-xs text-muted-foreground">
                {group.name}
              </DropdownMenuLabel>
            ) : null}
            {group.sites.map((site) => (
              <DropdownMenuItem key={site.id} asChild>
                <Link to="/sites/$siteId" params={{ siteId: site.id }}>
                  <span className="truncate">{site.name}</span>
                  {site.id === current.id ? (
                    <Check className="ml-auto size-4" />
                  ) : null}
                </Link>
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/">
            <LayoutGrid />
            All sites
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function SiteSectionsGroup({
  me,
  site,
  pathname,
}: {
  me: Me
  site: MeSite
  pathname: string
}) {
  const sections = siteSections(me, site)
  const collectionsQuery = useQuery({
    queryKey: queryKeys.collections(site.id),
    queryFn: () =>
      listCollectionsFn({ data: { siteId: site.id, enabledOnly: true } }),
  })
  const collections = collectionsQuery.data ?? []

  return (
    <SidebarGroup data-testid="site-nav">
      <SidebarGroupLabel>{site.name}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {sections.map((section) => {
            const active = isSectionActive(section, pathname)
            const Icon = section.icon
            return (
              <SidebarMenuItem key={section.key}>
                <SidebarMenuButton
                  asChild
                  isActive={active}
                  tooltip={section.label}
                >
                  <Link
                    to={section.href}
                    data-testid={section.testId}
                    aria-current={active ? 'page' : undefined}
                  >
                    <Icon />
                    <span>{section.label}</span>
                  </Link>
                </SidebarMenuButton>
                {section.key === 'content' && collections.length > 0 ? (
                  <SidebarMenuSub>
                    {collections.map((collection) => {
                      const href = `/sites/${site.id}/c/${collection.key}`
                      const subActive =
                        pathname === href || pathname.startsWith(`${href}/`)
                      return (
                        <SidebarMenuSubItem key={collection.id}>
                          <SidebarMenuSubButton asChild isActive={subActive}>
                            <Link
                              to="/sites/$siteId/c/$collectionKey"
                              params={{
                                siteId: site.id,
                                collectionKey: collection.key,
                              }}
                              aria-current={subActive ? 'page' : undefined}
                            >
                              <span>{collection.label}</span>
                            </Link>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                      )
                    })}
                  </SidebarMenuSub>
                ) : null}
              </SidebarMenuItem>
            )
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}
