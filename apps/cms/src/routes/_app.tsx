import { Outlet, createFileRoute, redirect } from '@tanstack/react-router'

import { AppShell } from '#/components/shell/app-shell'
import { NotFoundCard } from '#/components/shell/not-found'
import { StepUpProvider } from '#/features/security/step-up'
import { getMeFn } from '#/server/fn/me'
import { getSetupStatusFn } from '#/server/fn/setup'

/** Matches `/account` with or without a locale prefix (`/nl/account`). */
function isAccountPath(pathname: string) {
  return /^(\/[a-z]{2})?\/account(\/|$)/.test(pathname)
}

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
    // Agency admins must enrol in two-factor before anything else; the
    // account page is where they do it.
    if (me.mfaEnrolmentRequired && !isAccountPath(location.pathname)) {
      throw redirect({ to: '/account' })
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
    <StepUpProvider>
      <AppShell me={me}>
        <Outlet />
      </AppShell>
    </StepUpProvider>
  )
}
