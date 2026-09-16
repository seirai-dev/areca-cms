import { useState } from 'react'
import type { FormEvent } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Link, createFileRoute, notFound } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'

import { Alert, AlertDescription } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { BrandMark } from '#/components/brand-mark'
import { FormField } from '#/components/form-field'
import { AuthShell } from '#/components/language-switcher'
import { AuthDivider, ProviderSignIn } from '#/components/provider-sign-in'
import { authClient } from '#/lib/auth-client'
import { m } from '#/paraglide/messages'
import { localizeHref } from '#/paraglide/runtime'
import { getAuthMethodsFn } from '#/server/fn/auth-methods'
import { acceptInvitationFn, getInvitationFn } from '#/server/fn/me'

export const Route = createFileRoute('/invite/$token')({
  validateSearch: (search: Record<string, unknown>) => ({
    // Better Auth appends this when a provider round-trip fails.
    error: typeof search.error === 'string' ? search.error : undefined,
  }),
  loader: async ({ params }) => {
    try {
      const [invitation, methods] = await Promise.all([
        getInvitationFn({ data: { token: params.token } }),
        getAuthMethodsFn(),
      ])
      return { invitation, methods }
    } catch {
      throw notFound()
    }
  },
  notFoundComponent: () => (
    <AuthShell>
      <div className="w-full max-w-sm">
        <BrandMark className="mb-8" />
        <div className="mb-6 grid gap-1.5">
          <h1 className="text-2xl">{m.auth_invitation_not_found()}</h1>
          <p className="text-sm text-muted-foreground">
            {m.auth_invitation_invalid()}
          </p>
        </div>
        <div>
          <Button asChild variant="outline" className="w-full">
            <Link to="/login">{m.auth_go_to_sign_in()}</Link>
          </Button>
        </div>
      </div>
    </AuthShell>
  ),
  component: InvitePage,
})

function InvitePage() {
  const { invitation, methods } = Route.useLoaderData()
  const { token } = Route.useParams()
  const { error: providerError } = Route.useSearch()
  const { data: session, isPending: sessionPending } = authClient.useSession()
  const acceptInvitation = useServerFn(acceptInvitationFn)
  const [name, setName] = useState(invitation.email.split('@')[0] ?? '')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(
    providerError
      ? providerError === 'REGISTRATION_NOT_ALLOWED'
        ? m.auth_registration_not_allowed()
        : m.auth_could_not_sign_in()
      : null,
  )
  const [signingUp, setSigningUp] = useState(false)

  const acceptMutation = useMutation({
    mutationFn: () => acceptInvitation({ data: { token } }),
    onSuccess: () => {
      window.location.assign(localizeHref('/'))
    },
    onError: (err) => {
      setError(
        err instanceof Error
          ? err.message
          : m.auth_could_not_accept_invitation(),
      )
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
      setError(result.error.message ?? m.auth_could_not_create_account())
      setSigningUp(false)
      return
    }
    setSigningUp(false)
  }

  const loggedIn = Boolean(session?.user)

  return (
    <AuthShell>
      <div className="w-full max-w-md">
        <BrandMark className="mb-8" />
        <div className="mb-6 grid gap-1.5">
          <h1 className="text-2xl">{m.auth_invitation()}</h1>
          <p className="text-sm text-muted-foreground">
            {m.auth_join_as_role({
              organizationName: invitation.organizationName,
              role: invitation.role,
            })}
          </p>
        </div>
        <div className="grid gap-4">
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          {sessionPending ? (
            <p className="text-sm text-muted-foreground">
              {m.auth_loading_session()}
            </p>
          ) : loggedIn ? (
            <Button
              disabled={acceptMutation.isPending}
              onClick={() => acceptMutation.mutate()}
            >
              {acceptMutation.isPending ? m.auth_accepting() : m.auth_accept()}
            </Button>
          ) : (
            <>
              <ProviderSignIn
                methods={methods}
                callbackURL={`/invite/${token}`}
                errorCallbackURL={`/invite/${token}`}
              />
              {methods.emailPassword ? (
                <>
                  {methods.socials.length > 0 || methods.sso ? (
                    <AuthDivider />
                  ) : null}
                  <form className="grid gap-4" onSubmit={onSignUp}>
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
                        readOnly
                        value={invitation.email}
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
                    <Button type="submit" disabled={signingUp}>
                      {signingUp
                        ? m.auth_creating_account()
                        : m.auth_create_account()}
                    </Button>
                  </form>
                </>
              ) : null}
              <p className="text-sm text-muted-foreground">
                {m.auth_already_have_account()}{' '}
                <Link
                  to="/login"
                  search={{ redirect: `/invite/${token}` }}
                  className="underline"
                >
                  {m.auth_sign_in()}
                </Link>
              </p>
            </>
          )}
        </div>
      </div>
    </AuthShell>
  )
}
