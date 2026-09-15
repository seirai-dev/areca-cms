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
import { getSetupStatusFn } from '#/server/fn/setup'

export const Route = createFileRoute('/_app')({
  beforeLoad: async ({ location }) => {
    const { needsSetup } = await getSetupStatusFn()
    if (needsSetup) {
      throw redirect({ href: '/setup' })
    }
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
      <SidebarInset className="min-w-0">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:shadow"
        >
          Skip to content
        </a>
        <header className="sticky top-0 z-30 flex h-(--app-header-h) shrink-0 items-center gap-2 border-b bg-background px-3 sm:px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-1 h-4" />
          <AppBreadcrumbs me={me} />
        </header>
        <div
          id="main-content"
          className="mx-auto w-full max-w-7xl flex-1 px-4 py-5 sm:px-6 sm:py-6"
        >
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
