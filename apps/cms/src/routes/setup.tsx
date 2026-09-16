import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { createFileRoute, redirect } from '@tanstack/react-router'

import { Alert, AlertDescription } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { BrandMark } from '#/components/brand-mark'
import { FormField } from '#/components/form-field'
import { AuthShell } from '#/components/language-switcher'
import { authClient } from '#/lib/auth-client'
import { useBranding } from '#/lib/use-branding'
import { m } from '#/paraglide/messages'
import { localizeHref } from '#/paraglide/runtime'
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
  component: SetupPage,
})

function SetupPage() {
  const branding = useBranding()
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
      <div className="w-full max-w-sm">
        <BrandMark className="mb-8" />
        <div className="mb-6 grid gap-1.5">
          <h1 className="text-2xl">
            {m.auth_set_up_app({ appName: branding.appName })}
          </h1>
          <p className="text-sm text-muted-foreground">
            {m.auth_create_first_agency_admin()}
          </p>
        </div>
        <div>
          <form
            className="grid gap-4"
            method="post"
            onSubmit={onSubmit}
            data-testid="setup-form"
            data-ready={ready ? 'true' : 'false'}
          >
            {error ? (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
            <FormField label={m.auth_name()} htmlFor="name">
              <Input
                id="name"
                name="name"
                autoComplete="name"
                required
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
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </FormField>
            <Button type="submit" disabled={!ready || pending}>
              {pending
                ? m.auth_creating_admin()
                : m.auth_create_admin_account()}
            </Button>
          </form>
        </div>
      </div>
    </AuthShell>
  )
}
