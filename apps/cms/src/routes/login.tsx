import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { createFileRoute, redirect } from '@tanstack/react-router'

import { Alert, AlertDescription } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { BrandMark } from '#/components/brand-mark'
import { FormField } from '#/components/form-field'
import { authClient } from '#/lib/auth-client'
import { safeRedirectPath } from '#/lib/safe-redirect'
import { getMeFn } from '#/server/fn/me'
import { getSetupStatusFn } from '#/server/fn/setup'

type LoginSearch = {
  redirect?: string
}

export const Route = createFileRoute('/login')({
  validateSearch: (search: Record<string, unknown>): LoginSearch => ({
    redirect: typeof search.redirect === 'string' ? search.redirect : undefined,
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
  component: LoginPage,
})

function LoginPage() {
  const { redirect: redirectTo } = Route.useSearch()
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

    const result = await authClient.signIn.email({
      email,
      password,
    })
    if (result.error) {
      setError(result.error.message ?? 'Could not sign in')
      setPending(false)
      return
    }

    window.location.assign(safeRedirectPath(redirectTo))
  }

  return (
    <div className="flex min-h-svh items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <BrandMark className="mb-8" />
        <div className="mb-6 grid gap-1.5">
          <h1 className="text-2xl">Sign in</h1>
          <p className="text-sm text-muted-foreground">
            Use your email and password.
          </p>
        </div>
        <div>
          <form
            className="grid gap-4"
            method="post"
            onSubmit={onSubmit}
            data-ready={ready ? 'true' : 'false'}
          >
            {error ? (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
            <FormField label="Email" htmlFor="email">
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
            <FormField label="Password" htmlFor="password">
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
              {pending ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
        </div>
      </div>
    </div>
  )
}
