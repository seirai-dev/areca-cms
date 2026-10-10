import { createFileRoute, redirect } from '@tanstack/react-router'

import { LoginScreen } from '#/features/auth/login-screen'
import { OAuthContinue } from '#/features/auth/oauth-continue'
import { oauthQueryFromSearch } from '#/features/auth/oauth-resume'
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

/**
 * `/login`: first-run goes to /setup; signed-in people go on to `redirect`.
 * A sign-in that carries an AI app's signed authorization query is never
 * redirected here: it resumes that authorization instead.
 */
export const Route = createFileRoute('/login')({
  validateSearch: (search: Record<string, unknown>): LoginSearch => ({
    redirect: typeof search.redirect === 'string' ? search.redirect : undefined,
    error: typeof search.error === 'string' ? search.error : undefined,
    error_description:
      typeof search.error_description === 'string'
        ? search.error_description
        : undefined,
  }),
  beforeLoad: async ({ search, location }) => {
    const { needsSetup } = await getSetupStatusFn()
    if (needsSetup) {
      throw redirect({ href: '/setup' })
    }
    const me = await getMeFn()
    const oauthQuery = oauthQueryFromSearch(location.searchStr)
    if (me && !oauthQuery) {
      throw redirect({ href: safeRedirectPath(search.redirect) })
    }
    return { oauthQuery, signedIn: Boolean(me) }
  },
  loader: async () => getAuthMethodsFn(),
  component: LoginPage,
})

function LoginPage() {
  const methods = Route.useLoaderData()
  const { redirect: redirectTo, error } = Route.useSearch()
  const { oauthQuery, signedIn } = Route.useRouteContext()
  if (signedIn && oauthQuery) {
    return <OAuthContinue query={oauthQuery} />
  }
  return (
    <LoginScreen
      methods={methods}
      redirectTo={redirectTo}
      providerError={error}
      oauthQuery={oauthQuery}
    />
  )
}
