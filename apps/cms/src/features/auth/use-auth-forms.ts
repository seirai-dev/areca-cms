import * as React from 'react'

import { authClient } from '#/lib/auth-client'
import { signOutClient } from '#/lib/sign-out'
import { safeRedirectPath } from '#/lib/safe-redirect'
import { m } from '#/paraglide/messages'
import { getLocale, localizeHref } from '#/paraglide/runtime'
import { acceptInvitationFn } from '#/server/fn/me'
import { completeSetupFn } from '#/server/fn/setup'

import {
  continueOAuth,
  isPluginRedirect,
  redirectUrlFrom,
} from './oauth-resume'

/**
 * Auth logic, separate from the markup (brief §5.2). Every form reports its
 * failures inline, never as a toast, and navigates with a full page load so
 * the signed-in shell starts from a fresh session.
 */

/** True once React has hydrated: forms expose `data-ready` for tests. */
export function useHydrated() {
  const [ready, setReady] = React.useState(false)
  React.useEffect(() => setReady(true), [])
  return ready
}

/**
 * Better Auth reports provider failures as a code on the callback URL. The
 * invite-only gate is the one people actually hit, so it gets real copy.
 */
export function providerErrorMessage(code: string | undefined) {
  if (!code) return null
  return code === 'REGISTRATION_NOT_ALLOWED'
    ? m.auth_registration_not_allowed()
    : m.auth_could_not_sign_in()
}

function go(path: string) {
  window.location.assign(localizeHref(path))
}

/**
 * Where a successful sign-in goes next. Inside an AI app's authorization the
 * plugin names the next page (consent, or the app's redirect); otherwise
 * `redirect` (validated) or the home page.
 */
async function finishSignIn(
  data: unknown,
  oauthQuery: string | null,
  redirectTo: string | undefined,
) {
  // The client's redirect plugin already sends the browser to a `url` with
  // `redirect: true`; navigating again would abort that load.
  if (isPluginRedirect(data)) return
  const next = redirectUrlFrom(data)
  if (next) {
    window.location.assign(next)
    return
  }
  if (oauthQuery) {
    window.location.assign(await continueOAuth(oauthQuery))
    return
  }
  go(safeRedirectPath(redirectTo))
}

/**
 * Email + password sign-in, then on to `redirect` (validated). Accounts with
 * two-factor answer with a challenge instead of a session: `challenge` flips
 * on and the screen asks for a code (`verifyTwoFactor`). `oauthQuery` is set
 * when the sign-in resumes an AI app's authorization.
 */
export function usePasswordSignIn(
  redirectTo: string | undefined,
  initialError: string | null,
  oauthQuery: string | null = null,
) {
  const [error, setError] = React.useState<string | null>(initialError)
  const [pending, setPending] = React.useState(false)
  const [challenge, setChallenge] = React.useState(false)

  async function signIn(email: string, password: string) {
    setPending(true)
    setError(null)
    const result = await authClient.signIn.email({ email, password })
    if (result.error) {
      setError(result.error.message ?? m.auth_could_not_sign_in())
      setPending(false)
      return
    }
    if ('twoFactorRedirect' in result.data) {
      setChallenge(true)
      setPending(false)
      return
    }
    await finishOrFail(
      result.data,
      oauthQuery,
      redirectTo,
      setError,
      setPending,
    )
  }

  async function verifyTwoFactor(code: string, kind: 'totp' | 'backup') {
    setPending(true)
    setError(null)
    const trimmed = code.replace(/\s+/g, '')
    const result =
      kind === 'totp'
        ? await authClient.twoFactor.verifyTotp({ code: trimmed })
        : await authClient.twoFactor.verifyBackupCode({ code: trimmed })
    if (result.error) {
      setError(result.error.message ?? m.auth_two_factor_invalid_code())
      setPending(false)
      return
    }
    await finishOrFail(
      result.data,
      oauthQuery,
      redirectTo,
      setError,
      setPending,
    )
  }

  function cancelChallenge() {
    setChallenge(false)
    setError(null)
  }

  return {
    signIn,
    verifyTwoFactor,
    cancelChallenge,
    challenge,
    error,
    pending,
  }
}

/** Runs `finishSignIn`, reporting an expired AI-app link inline. */
async function finishOrFail(
  data: unknown,
  oauthQuery: string | null,
  redirectTo: string | undefined,
  setError: (message: string) => void,
  setPending: (pending: boolean) => void,
) {
  try {
    await finishSignIn(data, oauthQuery, redirectTo)
  } catch (err) {
    setError(err instanceof Error ? err.message : m.auth_could_not_sign_in())
    setPending(false)
  }
}

/**
 * First-run setup: create the agency admin, then sign straight in. When the
 * environment has password sign-in off, the admin still gets a password but
 * signs in through a provider on /login.
 */
export function useCompleteSetup(emailPassword: boolean) {
  const [error, setError] = React.useState<string | null>(null)
  const [pending, setPending] = React.useState(false)

  async function complete(input: {
    name: string
    email: string
    password: string
    setupToken: string
  }) {
    setPending(true)
    setError(null)
    try {
      // The language the setup screen is shown in: the admin's email language.
      await completeSetupFn({ data: { ...input, locale: getLocale() } })
    } catch (err) {
      setError(
        err instanceof Error ? err.message : m.auth_could_not_complete_setup(),
      )
      setPending(false)
      return
    }
    if (!emailPassword) {
      go('/login')
      return
    }
    const result = await authClient.signIn.email({
      email: input.email,
      password: input.password,
    })
    if (result.error) {
      setError(result.error.message ?? m.auth_account_created_sign_in_failed())
      setPending(false)
      return
    }
    go('/')
  }

  return { complete, error, pending }
}

/**
 * Invitation: signed in, one click joins; signed out, creating the account
 * joins automatically (brief §3.1: no second click). Both end on `/`, which
 * resolves to the new site.
 */
export function useInvitation(token: string, initialError: string | null) {
  const [error, setError] = React.useState<string | null>(initialError)
  const [pending, setPending] = React.useState<'accept' | 'sign-up' | null>(
    null,
  )

  async function accept(mode: 'accept' | 'sign-up' = 'accept') {
    setPending(mode)
    setError(null)
    try {
      await acceptInvitationFn({ data: { token } })
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : m.auth_could_not_accept_invitation(),
      )
      setPending(null)
      return false
    }
    go('/')
    return true
  }

  async function signUpAndJoin(input: {
    name: string
    email: string
    password: string
  }) {
    setPending('sign-up')
    setError(null)
    const result = await authClient.signUp.email({
      ...input,
      invitationToken: token,
    } as typeof input)
    if (result.error) {
      setError(result.error.message ?? m.auth_could_not_create_account())
      setPending(null)
      return
    }
    // The sign-up response sets the session cookie; accept right away.
    await accept('sign-up')
  }

  async function signOut() {
    await signOutClient()
    window.location.reload()
  }

  return { accept, signUpAndJoin, signOut, error, pending }
}
