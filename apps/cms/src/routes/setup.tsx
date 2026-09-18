import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { createFileRoute, redirect } from '@tanstack/react-router'

import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Spinner } from '#/components/ui/spinner'
import { FormField } from '#/components/form-field'
import { AuthError, AuthHeading, AuthShell } from '#/components/auth-shell'
import { authClient } from '#/lib/auth-client'
import { useBranding } from '#/lib/use-branding'
import { m } from '#/paraglide/messages'
import { localizeHref } from '#/paraglide/runtime'
import { getAuthMethodsFn } from '#/server/fn/auth-methods'
import { getMeFn } from '#/server/fn/me'
import { completeSetupFn, getSetupStatusFn } from '#/server/fn/setup'

export const Route = createFileRoute('/setup')({
  beforeLoad: async () => {
    const { needsSetup } = await getSetupStatusFn()
    if (!needsSetup) {
      const me = await getMeFn()
      throw redirect({ href: me ? '/' : '/login' })
    }
  },
  loader: async () => getAuthMethodsFn(),
  component: SetupPage,
})

function SetupPage() {
  const branding = useBranding()
  const methods = Route.useLoaderData()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
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

    try {
      await completeSetupFn({
        data: { name, email, password },
      })
    } catch (err) {
      setError(
        err instanceof Error ? err.message : m.auth_could_not_complete_setup(),
      )
      setPending(false)
      return
    }

    // The admin always gets a password here, but password sign-in may be off
    // in the environment; in that case send them to the providers instead.
    if (!methods.emailPassword) {
      window.location.assign(localizeHref('/login'))
      return
    }

    const result = await authClient.signIn.email({ email, password })
    if (result.error) {
      setError(result.error.message ?? m.auth_account_created_sign_in_failed())
      setPending(false)
      return
    }

    window.location.assign(localizeHref('/'))
  }

  return (
    <AuthShell>
      <AuthHeading
        title={m.auth_set_up_app({ appName: branding.appName })}
        description={m.auth_create_first_agency_admin()}
      />
      <form
        className="mt-8 grid gap-4"
        method="post"
        onSubmit={onSubmit}
        data-testid="setup-form"
        data-ready={ready ? 'true' : 'false'}
      >
        <FormField label={m.auth_name()} htmlFor="name">
          <Input
            id="name"
            name="name"
            autoComplete="name"
            required
            className="h-10"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </FormField>
        <FormField label={m.auth_email()} htmlFor="email">
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            className="h-10"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </FormField>
        <FormField label={m.auth_password()} htmlFor="password">
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            className="h-10"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </FormField>
        <Button
          type="submit"
          size="lg"
          className="mt-2 w-full"
          disabled={!ready || pending}
        >
          {pending ? <Spinner /> : null}
          {m.auth_create_admin_account()}
        </Button>
        {error ? <AuthError>{error}</AuthError> : null}
      </form>
    </AuthShell>
  )
}
