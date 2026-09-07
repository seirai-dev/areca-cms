import { useEffect, useState } from 'react'
import { Link, useRouterState } from '@tanstack/react-router'
import {
  Building2,
  ClipboardList,
  Globe,
  LayoutDashboard,
  LogOut,
  Users,
} from 'lucide-react'

import { Avatar, AvatarFallback } from '#/components/ui/avatar'
import { Button } from '#/components/ui/button'
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
} from '#/components/ui/sidebar'
import { authClient } from '#/lib/auth-client'
import type { Me } from '#/server/fn/me'

function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('') || 'U'
  )
}

export function AppSidebar({ me }: { me: Me }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const [ready, setReady] = useState(false)

  useEffect(() => {
    setReady(true)
  }, [])

  async function signOut() {
    try {
      await authClient.signOut()
    } finally {
      window.location.assign('/login')
    }
  }

  return (
    <Sidebar>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link to="/">
                <div className="flex size-8 items-center justify-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground">
                  <Globe className="size-4" />
                </div>
                <span className="text-base font-semibold">Areca</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup data-testid="sites-nav">
          <SidebarGroupLabel>Sites</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {me.sites.map((site) => (
                <SidebarMenuItem key={site.id}>
                  <SidebarMenuButton
                    asChild
                    isActive={pathname.startsWith(`/sites/${site.id}`)}
                    tooltip={site.name}
                  >
                    <Link to="/sites/$siteId" params={{ siteId: site.id }}>
                      <LayoutDashboard />
                      <span>{site.name}</span>
                      {site.slug !== site.name ? (
                        <span className="text-muted-foreground">
                          {site.slug}
                        </span>
                      ) : null}
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        {me.user.isAgencyAdmin ? (
          <SidebarGroup data-testid="agency-nav">
            <SidebarGroupLabel>Agency</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    isActive={pathname.startsWith('/admin/organizations')}
                  >
                    <a href="/admin/organizations">
                      <Building2 />
                      <span>Organizations</span>
                    </a>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    isActive={pathname.startsWith('/admin/users')}
                  >
                    <a href="/admin/users">
                      <Users />
                      <span>Users</span>
                    </a>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    isActive={pathname.startsWith('/admin/audit')}
                  >
                    <a href="/admin/audit">
                      <ClipboardList />
                      <span>Audit</span>
                    </a>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ) : null}
      </SidebarContent>
      <SidebarFooter>
        <div
          data-testid="user-menu"
          className="flex items-center gap-2 rounded-md p-2"
        >
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
        <Button
          data-testid="sign-out"
          variant="ghost"
          className="w-full justify-start"
          disabled={!ready}
          onClick={() => void signOut()}
        >
          <LogOut />
          Sign out
        </Button>
      </SidebarFooter>
    </Sidebar>
  )
}
