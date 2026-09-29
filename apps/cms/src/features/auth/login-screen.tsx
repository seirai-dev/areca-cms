import * as React from 'react'

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
import { providerErrorMessage, useHydrated, usePasswordSignIn } from './use-auth-forms'

/**
 * `/login` (brief §3.1): "Sign in to {app}", email and password, provider
 * buttons under a hairline "or", errors inline in the card. There is no
 * forgotten-password link because that feature does not exist.
 */
export function LoginScreen({
  methods,
  redirectTo,
  providerError,
}: {
  methods: AuthMethods
  redirectTo: string | undefined
  providerError: string | undefined
}) {
  const branding = useBranding()
  const ready = useHydrated()
  const [email, setEmail] = React.useState('')
  const [password, setPassword] = React.useState('')
  const { signIn, error, pending } = usePasswordSignIn(
    redirectTo,
    providerErrorMessage(providerError),
  )
  const hasProviders = methods.socials.length > 0 || Boolean(methods.sso)

  return (
    <AuthShell>
      <AuthHeading
        title={m.auth_sign_in_to({ appName: branding.appName })}
        description={
          methods.emailPassword
            ? m.auth_sign_in_subtitle()
            : m.auth_sign_in_subtitle_providers()
        }
      />
      <div className="mt-7 grid gap-5">
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
            <FormField label={m.auth_password()} htmlFor="password">
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
              size="lg"
              className="mt-1 w-full"
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
              callbackURL={safeRedirectPath(redirectTo)}
              errorCallbackURL="/login"
            />
          </>
        ) : null}
      </div>
    </AuthShell>
  )
}
