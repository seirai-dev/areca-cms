import * as React from 'react'

import { Button } from '#/components/ui/button'
import { providerRequest } from '#/features/auth/provider-request'
import { authClient } from '#/lib/auth-client'
import type { ReauthProvider } from '#/lib/reauth-provider'
import { signOutClient } from '#/lib/sign-out'
import { m } from '#/paraglide/messages'

/** Brand names are proper nouns, so they are not translated. */
const PROVIDER_LABELS = {
  github: () => m.auth_continue_with_github(),
  google: () => m.auth_continue_with_google(),
  discord: () => m.auth_continue_with_discord(),
}

/**
 * A provider-only account whose sign-in is too old for a sensitive change
 * (two-factor, email). Signing in again with the same provider starts a fresh
 * session and comes back to `#returnHash` on this page. Without a usable
 * provider, sign out and back in.
 */
export function ReauthStep({
  reauth,
  body,
  returnHash,
  testId,
  onCancel,
}: {
  reauth: ReauthProvider | null
  /** Why a fresh sign-in is needed. */
  body: string
  returnHash: string
  testId: string
  onCancel: () => void
}) {
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const label =
    reauth?.kind === 'sso'
      ? m.auth_continue_with_microsoft()
      : reauth
        ? PROVIDER_LABELS[reauth.provider]()
        : m.account_two_factor_reauth_sign_in()

  async function signInAgain() {
    setPending(true)
    setError(null)
    const back = `${window.location.pathname}#${returnHash}`
    try {
      if (!reauth) {
        await signOutClient()
        window.location.assign(`/login?redirect=${encodeURIComponent(back)}`)
        return
      }
      await providerRequest(() =>
        reauth.kind === 'sso'
          ? authClient.signIn.sso({
              providerId: reauth.providerId,
              callbackURL: back,
              errorCallbackURL: back,
            })
          : authClient.signIn.social({
              provider: reauth.provider,
              callbackURL: back,
              errorCallbackURL: back,
            }),
      )
    } catch (failure) {
      setError(
        failure instanceof Error && failure.message
          ? failure.message
          : m.auth_could_not_sign_in(),
      )
      setPending(false)
    }
  }

  return (
    <div className="grid gap-4" data-testid={testId}>
      <div className="grid gap-1">
        <p className="text-headline text-text-primary">
          {m.account_two_factor_reauth_title()}
        </p>
        <p className="text-callout text-text-secondary">{body}</p>
      </div>
      {error ? (
        <p
          role="alert"
          data-testid={`${testId}-error`}
          className="text-callout text-text-error"
        >
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          loading={pending}
          onClick={() => void signInAgain()}
          data-testid={`${testId}-sign-in`}
        >
          {label}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          {m.shared_cancel()}
        </Button>
      </div>
    </div>
  )
}
