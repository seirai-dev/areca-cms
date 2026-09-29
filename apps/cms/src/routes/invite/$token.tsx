import { useState } from 'react'
import type { FormEvent } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Link, createFileRoute, notFound } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'

import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Spinner } from '#/components/ui/spinner'
import { FormField } from '#/components/ui/form-field'
import {
  AuthDivider,
  AuthError,
  AuthHeading,
  AuthShell,
} from '#/components/auth-shell'
import { ProviderSignIn } from '#/components/provider-sign-in'
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
      <AuthHeading
        title={m.auth_invitation_not_found()}
        description={m.auth_invitation_invalid()}
      />
      <div className="mt-8">
        <Button asChild variant="outline" size="lg" className="w-full">
          <Link to="/login">{m.auth_go_to_sign_in()}</Link>
        </Button>
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

  const providers = methods.socials.length > 0 || Boolean(methods.sso)

  return (
    <AuthShell>
      <AuthHeading
        title={m.auth_invitation()}
        description={m.auth_join_as_role({
          organizationName: invitation.organizationName,
          role: invitation.role,
        })}
      />
      <div className="mt-8 grid gap-6">
        {sessionPending ? (
          <p className="text-ds-body-sm text-text-muted">
            {m.auth_loading_session()}
          </p>
        ) : loggedIn ? (
          <div className="grid gap-4">
            <Button
              size="lg"
              className="w-full"
              disabled={acceptMutation.isPending}
              onClick={() => acceptMutation.mutate()}
            >
              {acceptMutation.isPending ? <Spinner /> : null}
              {m.auth_accept()}
            </Button>
            {error ? <AuthError>{error}</AuthError> : null}
          </div>
        ) : (
          <>
            {methods.emailPassword ? (
              <form className="grid gap-4" onSubmit={onSignUp}>
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
                    readOnly
                    className="h-10"
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
                    className="h-10"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                </FormField>
                <Button
                  type="submit"
                  size="lg"
                  className="mt-2 w-full"
                  disabled={signingUp}
                >
                  {signingUp ? <Spinner /> : null}
                  {m.auth_create_account()}
                </Button>
                {error ? <AuthError>{error}</AuthError> : null}
              </form>
            ) : error ? (
              <AuthError>{error}</AuthError>
            ) : null}
            {providers ? (
              <div className="grid gap-4">
                {methods.emailPassword ? <AuthDivider /> : null}
                <ProviderSignIn
                  methods={methods}
                  callbackURL={`/invite/${token}`}
                  errorCallbackURL={`/invite/${token}`}
                />
              </div>
            ) : null}
            <p className="text-ds-body-sm text-text-secondary">
              {m.auth_already_have_account()}{' '}
              <Link
                to="/login"
                search={{ redirect: `/invite/${token}` }}
                className="text-text-accent underline underline-offset-4"
              >
                {m.auth_sign_in()}
              </Link>
            </p>
          </>
        )}
      </div>
    </AuthShell>
  )
}
