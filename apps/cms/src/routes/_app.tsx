import { Outlet, createFileRoute, redirect } from '@tanstack/react-router'

import { AppShell } from '#/components/shell/app-shell'
import { NotFoundCard } from '#/components/shell/not-found'
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
  notFoundComponent: () => <NotFoundCard />,
  component: AppLayout,
})

/** Signed-in frame: the shell (sidebar, mobile bars, panels, palette). */
function AppLayout() {
  const { me } = Route.useRouteContext()
  return (
    <AppShell me={me}>
      <Outlet />
    </AppShell>
  )
}
