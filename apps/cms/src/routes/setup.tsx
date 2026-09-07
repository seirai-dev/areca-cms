import { useEffect, useState, type FormEvent } from 'react'
import { createFileRoute, redirect } from '@tanstack/react-router'

import { Alert, AlertDescription } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { Input } from '#/components/ui/input'
import { FormField } from '#/components/form-field'
import { authClient } from '#/lib/auth-client'
import { completeSetupFn, getSetupStatusFn } from '#/server/fn/setup'

export const Route = createFileRoute('/setup')({
  beforeLoad: async () => {
    const { needsSetup } = await getSetupStatusFn()
    if (!needsSetup) {
      throw redirect({ href: '/login' })
    }
  },
  component: SetupPage,
})

function SetupPage() {
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
      setError(err instanceof Error ? err.message : 'Could not complete setup')
      setPending(false)
      return
    }

    const result = await authClient.signIn.email({ email, password })
    if (result.error) {
      setError(result.error.message ?? 'Account created, but sign-in failed')
      setPending(false)
      return
    }

    window.location.assign('/')
  }

  return (
    <div className="flex min-h-svh items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Set up Areca</CardTitle>
          <CardDescription>
            Create the first agency admin. This can only be done while no
            accounts exist.
          </CardDescription>
        </CardHeader>
        <CardContent>
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
            <FormField label="Name" htmlFor="name">
              <Input
                id="name"
                name="name"
                autoComplete="name"
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </FormField>
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
                autoComplete="new-password"
                required
                minLength={8}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </FormField>
            <Button type="submit" disabled={!ready || pending}>
              {pending ? 'Creating admin…' : 'Create admin account'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
