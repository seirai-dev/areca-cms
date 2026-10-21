import * as React from 'react'
import { Link } from '@tanstack/react-router'

import { Button } from '#/components/ui/button'
import { FormField } from '#/components/ui/form-field'
import { Input } from '#/components/ui/input'
import type { AuthMethods } from '#/lib/auth-providers'
import { safeRedirectPath } from '#/lib/safe-redirect'
import { useBranding } from '#/lib/use-branding'
import { m } from '#/paraglide/messages'

import { AuthDivider, AuthError, AuthHeading, AuthShell } from './auth-shell'
import { PasswordInput } from './password-input'
import { ProviderSignIn } from './provider-buttons'
import { TwoFactorChallenge } from './two-factor-challenge'
import {
  providerErrorMessage,
  useHydrated,
  usePasswordSignIn,
} from './use-auth-forms'

/**
 * `/login` (brief §3.1): "Sign in to {app}", email and password, provider
 * buttons under a hairline "or", errors inline in the card. "Forgot password?"
 * sits beside the password label when email/password sign-in is on.
 */
export function LoginScreen({
  methods,
  redirectTo,
  providerError,
  oauthQuery,
}: {
  methods: AuthMethods
  redirectTo: string | undefined
  providerError: string | undefined
  /** The signed authorization query when this sign-in is for an AI app. */
  oauthQuery: string | null
}) {
  const branding = useBranding()
  const ready = useHydrated()
  const [email, setEmail] = React.useState('')
  const [password, setPassword] = React.useState('')
  const {
    signIn,
    verifyTwoFactor,
    cancelChallenge,
    challenge,
    error,
    pending,
  } = usePasswordSignIn(
    redirectTo,
    providerErrorMessage(providerError),
    oauthQuery,
  )
  const hasProviders = methods.socials.length > 0 || Boolean(methods.sso)
  // After a provider round trip the browser returns here with the query, so
  // the sign-in resumes the AI app's authorization.
  const oauthLoginPath = oauthQuery ? `/login?${oauthQuery}` : null

  if (challenge) {
    return (
      <AuthShell>
        <AuthHeading
          title={m.auth_two_factor_title()}
          description={m.auth_two_factor_subtitle()}
        />
        <TwoFactorChallenge
          ready={ready}
          error={error}
          pending={pending}
          onSubmit={(code, kind) => void verifyTwoFactor(code, kind)}
          onCancel={cancelChallenge}
        />
      </AuthShell>
    )
  }

  return (
    <AuthShell>
      <AuthHeading
        title={m.auth_sign_in_to({ appName: branding.appName })}
        description={
          oauthQuery
            ? m.auth_sign_in_oauth_subtitle({ appName: branding.appName })
            : methods.emailPassword
              ? m.auth_sign_in_subtitle()
              : m.auth_sign_in_subtitle_providers()
        }
      />
      <div className="grid gap-5">
        {methods.emailPassword ? (
          <form
            className="grid gap-4"
            method="post"
            data-testid="login-form"
            data-ready={ready ? 'true' : 'false'}
            onSubmit={(event) => {
              event.preventDefault()
              event.stopPropagation()
              void signIn(email, password)
            }}
          >
            <FormField label={m.auth_email()} htmlFor="email">
              <Input
                id="email"
                name="email"
                type="email"
                inputSize="lg"
                autoComplete="email"
                autoFocus
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </FormField>
            <FormField
              label={m.auth_password()}
              htmlFor="password"
              trailing={
                <Link
                  to="/forgot-password"
                  className="text-caption font-normal text-text-secondary underline-offset-4 hover:text-text-primary hover:underline"
                  data-testid="forgot-password-link"
                >
                  {m.auth_forgot_link()}
                </Link>
              }
            >
              <PasswordInput
                id="password"
                name="password"
                inputSize="lg"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </FormField>
            {error ? <AuthError>{error}</AuthError> : null}
            <Button
              type="submit"
              variant="accent"
              size="lg"
              className="w-full"
              disabled={!ready}
              loading={pending}
            >
              {m.auth_sign_in()}
            </Button>
          </form>
        ) : error ? (
          <AuthError>{error}</AuthError>
        ) : null}
        {hasProviders ? (
          <>
            {methods.emailPassword ? <AuthDivider /> : null}
            <ProviderSignIn
              methods={methods}
              callbackURL={oauthLoginPath ?? safeRedirectPath(redirectTo)}
              errorCallbackURL={oauthLoginPath ?? '/login'}
            />
          </>
        ) : null}
      </div>
    </AuthShell>
  )
}
