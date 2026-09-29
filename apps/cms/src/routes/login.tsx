import { createFileRoute, redirect } from '@tanstack/react-router'

import { LoginScreen } from '#/features/auth/login-screen'
import { safeRedirectPath } from '#/lib/safe-redirect'
import { getAuthMethodsFn } from '#/server/fn/auth-methods'
import { getMeFn } from '#/server/fn/me'
import { getSetupStatusFn } from '#/server/fn/setup'

type LoginSearch = {
  redirect?: string
  /** Set by Better Auth when a provider round-trip fails. */
  error?: string
  error_description?: string
}

/** `/login`: first-run goes to /setup; signed-in people go on to `redirect`. */
export const Route = createFileRoute('/login')({
  validateSearch: (search: Record<string, unknown>): LoginSearch => ({
    redirect: typeof search.redirect === 'string' ? search.redirect : undefined,
    error: typeof search.error === 'string' ? search.error : undefined,
    error_description:
      typeof search.error_description === 'string'
        ? search.error_description
        : undefined,
  }),
  beforeLoad: async ({ search }) => {
    const { needsSetup } = await getSetupStatusFn()
    if (needsSetup) {
      throw redirect({ href: '/setup' })
    }
    const me = await getMeFn()
    if (me) {
      throw redirect({ href: safeRedirectPath(search.redirect) })
    }
  },
  loader: async () => getAuthMethodsFn(),
  component: LoginPage,
})

function LoginPage() {
  const methods = Route.useLoaderData()
  const { redirect: redirectTo, error } = Route.useSearch()
  return (
    <LoginScreen
      methods={methods}
      redirectTo={redirectTo}
      providerError={error}
    />
  )
}
