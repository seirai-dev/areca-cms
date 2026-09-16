import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { createFileRoute, redirect } from '@tanstack/react-router'

import { Alert, AlertDescription } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { BrandMark } from '#/components/brand-mark'
import { FormField } from '#/components/form-field'
import { AuthShell } from '#/components/language-switcher'
import { AuthDivider, ProviderSignIn } from '#/components/provider-sign-in'
import { authClient } from '#/lib/auth-client'
import { safeRedirectPath } from '#/lib/safe-redirect'
import { m } from '#/paraglide/messages'
import { localizeHref } from '#/paraglide/runtime'
import { getAuthMethodsFn } from '#/server/fn/auth-methods'
import { getMeFn } from '#/server/fn/me'
import { getSetupStatusFn } from '#/server/fn/setup'

type LoginSearch = {
  redirect?: string
  /** Set by Better Auth when a provider round-trip fails. */
  error?: string
  error_description?: string
}

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

/**
 * Better Auth reports provider failures as a code on the callback URL. The
 * invite-only gate is the one people will actually hit, so it gets a real
 * message; anything else falls back to the generic failure.
 */
function providerErrorMessage(code: string) {
  return code === 'REGISTRATION_NOT_ALLOWED'
    ? m.auth_registration_not_allowed()
    : m.auth_could_not_sign_in()
}

function LoginPage() {
  const methods = Route.useLoaderData()
  const { redirect: redirectTo, error: providerError } = Route.useSearch()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(
    providerError ? providerErrorMessage(providerError) : null,
  )
  const [pending, setPending] = useState(false)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    setReady(true)
  }, [])

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    event.stopPropagation()
    setPending(true)
    setError(null)

    const result = await authClient.signIn.email({
      email,
      password,
    })
    if (result.error) {
      setError(result.error.message ?? m.auth_could_not_sign_in())
      setPending(false)
      return
    }

    window.location.assign(localizeHref(safeRedirectPath(redirectTo)))
  }

  return (
    <AuthShell>
      <div className="w-full max-w-sm">
        <BrandMark className="mb-8" />
        <div className="mb-6 grid gap-1.5">
          <h1 className="text-2xl">{m.auth_sign_in()}</h1>
          <p className="text-sm text-muted-foreground">
            {methods.emailPassword
              ? m.auth_use_email_and_password()
              : m.auth_use_a_provider()}
          </p>
        </div>
        <div className="grid gap-4">
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <ProviderSignIn
            methods={methods}
            callbackURL={safeRedirectPath(redirectTo)}
            errorCallbackURL="/login"
          />
          {methods.emailPassword ? (
            <>
              {methods.socials.length > 0 || methods.sso ? (
                <AuthDivider />
              ) : null}
              <form
                className="grid gap-4"
                method="post"
                onSubmit={onSubmit}
                data-ready={ready ? 'true' : 'false'}
              >
                <FormField label={m.auth_email()} htmlFor="email">
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                  />
                </FormField>
                <FormField label={m.auth_password()} htmlFor="password">
                  <Input
                    id="password"
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                </FormField>
                <Button type="submit" disabled={!ready || pending}>
                  {pending ? m.auth_signing_in() : m.auth_sign_in()}
                </Button>
              </form>
            </>
          ) : null}
        </div>
      </div>
    </AuthShell>
  )
}
