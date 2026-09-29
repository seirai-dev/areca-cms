import * as React from 'react'

import { authClient } from '#/lib/auth-client'
import { safeRedirectPath } from '#/lib/safe-redirect'
import { m } from '#/paraglide/messages'
import { localizeHref } from '#/paraglide/runtime'
import { acceptInvitationFn } from '#/server/fn/me'
import { completeSetupFn } from '#/server/fn/setup'

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

/** Email + password sign-in, then on to `redirect` (validated). */
export function usePasswordSignIn(redirectTo: string | undefined, initialError: string | null) {
  const [error, setError] = React.useState<string | null>(initialError)
  const [pending, setPending] = React.useState(false)

  async function signIn(email: string, password: string) {
    setPending(true)
    setError(null)
    const result = await authClient.signIn.email({ email, password })
    if (result.error) {
      setError(result.error.message ?? m.auth_could_not_sign_in())
      setPending(false)
      return
    }
    go(safeRedirectPath(redirectTo))
  }

  return { signIn, error, pending }
}

/**
 * First-run setup: create the agency admin, then sign straight in. When the
 * environment has password sign-in off, the admin still gets a password but
 * signs in through a provider on /login.
 */
export function useCompleteSetup(emailPassword: boolean) {
  const [error, setError] = React.useState<string | null>(null)
  const [pending, setPending] = React.useState(false)

  async function complete(input: { name: string; email: string; password: string }) {
    setPending(true)
    setError(null)
    try {
      await completeSetupFn({ data: input })
    } catch (err) {
      setError(err instanceof Error ? err.message : m.auth_could_not_complete_setup())
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
  const [pending, setPending] = React.useState<'accept' | 'sign-up' | null>(null)

  async function accept(mode: 'accept' | 'sign-up' = 'accept') {
    setPending(mode)
    setError(null)
    try {
      await acceptInvitationFn({ data: { token } })
    } catch (err) {
      setError(err instanceof Error ? err.message : m.auth_could_not_accept_invitation())
      setPending(null)
      return false
    }
    go('/')
    return true
  }

  async function signUpAndJoin(input: { name: string; email: string; password: string }) {
    setPending('sign-up')
    setError(null)
    const result = await authClient.signUp.email(input)
    if (result.error) {
      setError(result.error.message ?? m.auth_could_not_create_account())
      setPending(null)
      return
    }
    // The sign-up response sets the session cookie; accept right away.
    await accept('sign-up')
  }

  async function signOut() {
    await authClient.signOut()
    window.location.reload()
  }

  return { accept, signUpAndJoin, signOut, error, pending }
}
