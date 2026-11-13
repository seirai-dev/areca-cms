import { Outlet, createFileRoute, redirect } from '@tanstack/react-router'
import { LazyMotion } from 'motion/react'

import { AppShell } from '#/components/shell/app-shell'
import { NotFoundCard } from '#/components/shell/not-found'
import { StepUpProvider } from '#/features/security/step-up'
import { loadMe } from '#/lib/me-query'
import { getSetupStatusFn } from '#/server/fn/setup'

/** Matches `/account` with or without a locale prefix (`/nl/account`). */
function isAccountPath(pathname: string) {
  return /^(\/[a-z]{2})?\/account(\/|$)/.test(pathname)
}

export const Route = createFileRoute('/_app')({
  // Runs on every navigation, tab switches included, so `me` comes from a
  // short cache (lib/me-query.ts).
  beforeLoad: async ({ context, location }) => {
    const me = await loadMe(context.queryClient)
    if (!me) {
      // Setup is only open before the first user exists, so only a signed-out
      // visitor needs to ask.
      const { needsSetup } = await getSetupStatusFn()
      if (needsSetup) {
        throw redirect({ href: '/setup' })
      }
      throw redirect({
        to: '/login',
        search: { redirect: location.href },
      })
    }
    // Agency admins must enrol in two-factor before anything else, and anyone
    // with two-factor on enters a code once per session; the account page is
    // where they do it.
    if (
      (me.mfaEnrolmentRequired || me.mfaVerificationRequired) &&
      !isAccountPath(location.pathname)
    ) {
      throw redirect({ to: '/account' })
    }
    return { me }
  },
  notFoundComponent: () => <NotFoundCard />,
  component: AppLayout,
})

const loadMotionFeatures = () =>
  import('#/lib/motion-features').then((mod) => mod.default)

/** Signed-in frame: the shell (sidebar, mobile bars, panels, palette). */
function AppLayout() {
  const { me } = Route.useRouteContext()
  return (
    <LazyMotion features={loadMotionFeatures}>
      <StepUpProvider>
        <AppShell me={me}>
          <Outlet />
        </AppShell>
      </StepUpProvider>
    </LazyMotion>
  )
}
