import { Outlet, createFileRoute, redirect } from '@tanstack/react-router'

import { AppBreadcrumbs } from '#/components/app-breadcrumbs'
import { AppSidebar } from '#/components/app-sidebar'
import { Separator } from '#/components/ui/separator'
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from '#/components/ui/sidebar'
import { getMeFn } from '#/server/fn/me'

export const Route = createFileRoute('/_app')({
  beforeLoad: async ({ location }) => {
    const me = await getMeFn()
    if (!me) {
      throw redirect({
        to: '/login',
        search: { redirect: location.href },
      })
    }
    return { me }
  },
  component: AppLayout,
})

function AppLayout() {
  const { me } = Route.useRouteContext()

  return (
    <SidebarProvider>
      <AppSidebar me={me} />
      <SidebarInset>
        <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger />
          <Separator orientation="vertical" className="h-4" />
          <AppBreadcrumbs me={me} />
        </header>
        <div className="flex-1 p-6">
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
