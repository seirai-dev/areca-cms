import { Outlet, createFileRoute, redirect } from '@tanstack/react-router'

import { CommandPalette } from '#/components/command-palette'
import { Navbar } from '#/components/navbar'
import { m } from '#/paraglide/messages'
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

/**
 * App shell: one navbar, then the page. Identity strips are rendered by the
 * route that owns them (site frame, organization detail), so the frame stays
 * a single column.
 */
function AppLayout() {
  const { me } = Route.useRouteContext()

  return (
    <div className="min-h-svh bg-background-default">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-above-overlay focus:rounded-control focus:bg-background-elevated focus:px-3 focus:py-2 focus:text-ds-label-md focus:shadow-lg"
      >
        {m.shell_skip_to_content()}
      </a>
      <Navbar me={me} />
      <CommandPalette me={me} />
      <main
        id="main-content"
        className="mx-auto w-full max-w-6xl min-w-0 px-6 py-6"
      >
        <div className="animate-ds-enter-rise">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
