import { useState, type FormEvent } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Link, createFileRoute, notFound } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'

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
import { acceptInvitationFn, getInvitationFn } from '#/server/fn/me'

export const Route = createFileRoute('/invite/$token')({
  loader: async ({ params }) => {
    try {
      return await getInvitationFn({ data: { token: params.token } })
    } catch {
      throw notFound()
    }
  },
  component: InvitePage,
})

function InvitePage() {
  const invitation = Route.useLoaderData()
  const { token } = Route.useParams()
  const { data: session, isPending: sessionPending } = authClient.useSession()
  const acceptInvitation = useServerFn(acceptInvitationFn)
  const [name, setName] = useState(invitation.email.split('@')[0] ?? '')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [signingUp, setSigningUp] = useState(false)

  const acceptMutation = useMutation({
    mutationFn: () => acceptInvitation({ data: { token } }),
    onSuccess: () => {
      window.location.assign('/')
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : 'Could not accept invitation')
    },
  })

  async function onSignUp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSigningUp(true)
    setError(null)

    const result = await authClient.signUp.email({
      name,
      email: invitation.email,
      password,
    })

    if (result.error) {
      setError(result.error.message ?? 'Could not create account')
      setSigningUp(false)
      return
    }
    setSigningUp(false)
  }

  const loggedIn = Boolean(session?.user)

  return (
    <div className="flex min-h-svh items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl">Invitation</CardTitle>
          <CardDescription>
            Join {invitation.organizationName} as {invitation.role}.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          {sessionPending ? (
            <p className="text-sm text-muted-foreground">Loading session…</p>
          ) : loggedIn ? (
            <Button
              disabled={acceptMutation.isPending}
              onClick={() => acceptMutation.mutate()}
            >
              {acceptMutation.isPending ? 'Accepting…' : 'Accept'}
            </Button>
          ) : (
            <>
              <form className="grid gap-4" onSubmit={onSignUp}>
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
                    readOnly
                    value={invitation.email}
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
                <Button type="submit" disabled={signingUp}>
                  {signingUp ? 'Creating account…' : 'Create account'}
                </Button>
              </form>
              <p className="text-sm text-muted-foreground">
                Already have an account?{' '}
                <Link
                  to="/login"
                  search={{ redirect: `/invite/${token}` }}
                  className="underline"
                >
                  Sign in
                </Link>
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
