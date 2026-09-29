import * as React from 'react'
import { Link } from '@tanstack/react-router'
import { LinkBreak, LockSimple } from '@phosphor-icons/react'

import { UserAvatar } from '#/components/ui/avatar'
import { Button } from '#/components/ui/button'
import { FormField } from '#/components/ui/form-field'
import { Input } from '#/components/ui/input'
import { Skeleton } from '#/components/ui/skeleton'
import { authClient } from '#/lib/auth-client'
import type { AuthMethods } from '#/lib/auth-providers'
import type { MembershipRole } from '#/lib/types'
import { m } from '#/paraglide/messages'

import { AuthDivider, AuthError, AuthHeading, AuthShell } from './auth-shell'
import { PasswordInput } from './password-input'
import { ProviderSignIn } from './provider-buttons'
import {
  providerErrorMessage,
  useHydrated,
  useInvitation,
} from './use-auth-forms'

type Invitation = {
  email: string
  role: MembershipRole
  organizationName: string
}

/** "You'll join as an Editor — you can write and edit drafts." */
function roleLine(role: MembershipRole) {
  return role === 'owner'
    ? m.auth_invite_role_owner()
    : m.auth_invite_role_editor()
}

/**
 * `/invite/$token` (brief §3.1): "{Org} invited you" with the role in plain
 * language. Signed out: create an account (the email is a locked chip) and
 * join in one go, or use a provider, or sign in. Signed in: one "Join {Org}"
 * button.
 */
export function InviteScreen({
  token,
  invitation,
  methods,
  providerError,
}: {
  token: string
  invitation: Invitation
  methods: AuthMethods
  providerError: string | undefined
}) {
  const ready = useHydrated()
  const { data: session, isPending: sessionPending } = authClient.useSession()
  const invite = useInvitation(token, providerErrorMessage(providerError))
  const [name, setName] = React.useState(invitation.email.split('@')[0] ?? '')
  const [password, setPassword] = React.useState('')
  const hasProviders = methods.socials.length > 0 || Boolean(methods.sso)
  const user = session?.user

  return (
    <AuthShell
      showName
      footer={
        !sessionPending && !user ? (
          <>
            {m.auth_already_have_account()}{' '}
            <Link
              to="/login"
              search={{ redirect: `/invite/${token}` }}
              className="font-medium text-text-accent underline-offset-4 hover:underline"
              data-testid="invite-sign-in"
            >
              {m.auth_sign_in()}
            </Link>
          </>
        ) : null
      }
    >
      <AuthHeading
        title={m.auth_invited_you({
          organizationName: invitation.organizationName,
        })}
        description={roleLine(invitation.role)}
      />

      <div className="mt-7 grid gap-5" data-testid="invite-card">
        {sessionPending ? (
          <div
            className="grid gap-3"
            aria-busy="true"
            aria-label={m.auth_loading_session()}
          >
            <Skeleton className="h-11 w-full" />
            <Skeleton className="h-11 w-full" />
          </div>
        ) : user ? (
          <div className="grid gap-4">
            <div className="flex items-center gap-3 rounded-[12px] bg-background-subtle px-3.5 py-3">
              <UserAvatar name={user.name} image={user.image} size="md" />
              <div className="grid min-w-0 flex-1 gap-0.5">
                <span className="truncate text-[14px] leading-5 font-medium text-text-primary">
                  {user.name}
                </span>
                <span className="truncate text-caption font-normal text-text-muted">
                  {m.auth_invite_signed_in_as({ email: user.email })}
                </span>
              </div>
              <Button
                type="button"
                variant="quiet"
                size="xs"
                onClick={() => void invite.signOut()}
                data-testid="invite-sign-out"
              >
                {m.auth_invite_wrong_account()}
              </Button>
            </div>
            {invite.error ? <AuthError>{invite.error}</AuthError> : null}
            <Button
              type="button"
              size="lg"
              className="w-full"
              loading={invite.pending === 'accept'}
              onClick={() => void invite.accept()}
              data-testid="accept-invitation"
            >
              {m.auth_join_org({
                organizationName: invitation.organizationName,
              })}
            </Button>
          </div>
        ) : (
          <>
            {methods.emailPassword ? (
              <form
                className="grid gap-4"
                method="post"
                data-testid="invite-form"
                data-ready={ready ? 'true' : 'false'}
                onSubmit={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  void invite.signUpAndJoin({
                    name,
                    email: invitation.email,
                    password,
                  })
                }}
              >
                <FormField label={m.auth_email()} htmlFor="email">
                  {/* The locked chip: a read-only field, so password managers
                      still pair the new password with this address. */}
                  <div className="relative">
                    <LockSimple
                      aria-hidden="true"
                      className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-icon-muted"
                    />
                    <Input
                      id="email"
                      name="email"
                      type="email"
                      inputSize="lg"
                      autoComplete="username"
                      readOnly
                      aria-readonly="true"
                      title={m.auth_invite_email_locked()}
                      data-testid="invite-email"
                      className="rounded-full border-transparent pl-10 text-text-secondary shadow-none focus:ring-0 focus-visible:ring-0"
                      value={invitation.email}
                    />
                  </div>
                </FormField>
                <FormField label={m.auth_name()} htmlFor="name">
                  <Input
                    id="name"
                    name="name"
                    inputSize="lg"
                    autoComplete="name"
                    required
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                  />
                </FormField>
                <FormField
                  label={m.auth_password()}
                  htmlFor="password"
                  hint={m.auth_password_hint()}
                >
                  <PasswordInput
                    id="password"
                    name="password"
                    inputSize="lg"
                    autoComplete="new-password"
                    autoFocus
                    required
                    minLength={8}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                </FormField>
                {invite.error ? <AuthError>{invite.error}</AuthError> : null}
                <Button
                  type="submit"
                  size="lg"
                  className="mt-1 w-full"
                  disabled={!ready}
                  loading={invite.pending === 'sign-up'}
                >
                  {m.auth_create_account_and_join()}
                </Button>
              </form>
            ) : invite.error ? (
              <AuthError>{invite.error}</AuthError>
            ) : null}
            {hasProviders ? (
              <>
                {methods.emailPassword ? <AuthDivider /> : null}
                <ProviderSignIn
                  methods={methods}
                  callbackURL={`/invite/${token}`}
                  errorCallbackURL={`/invite/${token}`}
                />
              </>
            ) : null}
          </>
        )}
      </div>
    </AuthShell>
  )
}

/** Invalid, expired or used link: a friendly card and a way to sign in. */
export function InviteInvalid() {
  return (
    <AuthShell showName>
      <div
        className="grid justify-items-center gap-5 text-center"
        data-testid="invite-invalid"
      >
        <span
          aria-hidden="true"
          className="grid size-14 place-content-center rounded-[18px] bg-background-subtle text-icon-muted ring-8 ring-background-subtle/50"
        >
          <LinkBreak weight="duotone" className="size-7" />
        </span>
        <AuthHeading
          title={m.auth_invite_invalid_title()}
          description={m.auth_invite_invalid_body()}
        />
        <Button asChild variant="outline" size="lg" className="w-full">
          <Link to="/login">{m.auth_go_to_sign_in()}</Link>
        </Button>
      </div>
    </AuthShell>
  )
}
