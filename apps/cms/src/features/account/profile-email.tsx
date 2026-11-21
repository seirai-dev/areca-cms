import * as React from 'react'
import { useNavigate, useRouterState } from '@tanstack/react-router'
import { toast } from 'sonner'

import { Button } from '#/components/ui/button'
import { FormField } from '#/components/ui/form-field'
import { Input } from '#/components/ui/input'
import { PasswordInput } from '#/features/auth/password-input'
import { useStepUp } from '#/features/security/step-up'
import { authClient } from '#/lib/auth-client'
import type { ReauthProvider } from '#/lib/reauth-provider'
import { stripSecurityCode } from '#/lib/security-errors'
import { m } from '#/paraglide/messages'
import type { Me } from '#/server/fn/me'

import {
  emailChangeOutcome,
  emailMatches,
  withoutEmailChangeParams,
} from './account-logic'
import type { EmailChangeOutcome } from './account-logic'
import { ReauthStep } from './reauth-step'

/** Codes from `assertMayChangeEmail` (lib/auth.ts) that the form handles. */
const SIGN_IN_AGAIN = 'SIGN_IN_AGAIN'
const INVALID_PASSWORD = 'INVALID_PASSWORD'

/** A Better Auth client error, thrown so `useStepUp` can read its code. */
class AuthRequestError extends Error {
  constructor(
    message: string,
    readonly code: string | undefined,
  ) {
    super(message)
  }
}

function outcomeMessage(
  outcome: Extract<EmailChangeOutcome, { kind: 'failed' }>,
) {
  switch (outcome.reason) {
    case 'expired':
      return m.account_email_change_expired()
    case 'taken':
      return m.account_email_change_taken()
    case 'not_allowed':
      return m.server_email_change_forbidden()
    case 'invalid':
      return m.account_email_change_invalid()
  }
}

/**
 * Arriving from the confirmation link (`?emailChange=done`, plus `error` when
 * it did not apply) says what happened once, then drops the parameters so a
 * refresh is quiet.
 */
function EmailChangeOutcomeNotice() {
  const navigate = useNavigate()
  const outcome = useRouterState({
    select: (state) => emailChangeOutcome(state.location.searchStr),
  })
  const handled = React.useRef(false)

  React.useEffect(() => {
    if (!outcome || handled.current) return
    handled.current = true
    if (outcome.kind === 'changed') toast.success(m.account_email_changed())
    else toast.error(outcomeMessage(outcome))
    void navigate({
      to: '.',
      search: (previous) => withoutEmailChangeParams(previous),
      replace: true,
    })
  }, [outcome, navigate])

  return null
}

/**
 * The email row of the profile. Everyone sees the address; agency admins (a
 * Starter account is its own agency) can ask to move it. The server checks
 * the password, a two-factor code typed for this change (asked by
 * `useStepUp`) and mail delivery; the change applies once the new address
 * opens the link.
 */
export function ProfileEmail({
  me,
  hasPassword,
  reauth,
  mailConfigured,
}: {
  me: Me
  hasPassword: boolean
  reauth: ReauthProvider | null
  mailConfigured: boolean
}) {
  const stepUp = useStepUp()
  const [open, setOpen] = React.useState(false)
  const [newEmail, setNewEmail] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [pending, setPending] = React.useState(false)
  const [emailError, setEmailError] = React.useState<string | null>(null)
  const [passwordError, setPasswordError] = React.useState<string | null>(null)
  const [signInAgain, setSignInAgain] = React.useState(false)

  const admin = me.user.isAgencyAdmin
  const available = admin && mailConfigured && !me.mfaEnrolmentRequired
  const hint = !admin
    ? m.account_email_note()
    : me.mfaEnrolmentRequired
      ? m.account_email_needs_two_factor()
      : !mailConfigured
        ? m.account_email_needs_mail()
        : m.account_email_change_hint()

  function close() {
    setOpen(false)
    setSignInAgain(false)
    setNewEmail('')
    setPassword('')
    setEmailError(null)
    setPasswordError(null)
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const next = newEmail.trim()
    if (emailMatches(next, me.user.email)) {
      setEmailError(m.server_email_change_same())
      return
    }
    setPending(true)
    setEmailError(null)
    setPasswordError(null)
    try {
      // `currentPassword` is read by the server's before hook, not by Better
      // Auth's own body schema, so it is passed through a plain object.
      const body = { newEmail: next, currentPassword: password }
      await stepUp.run(async () => {
        const result = await authClient.changeEmail(body)
        if (result.error) {
          throw new AuthRequestError(
            result.error.message ?? m.account_email_failed(),
            result.error.code,
          )
        }
      })
      toast.success(m.account_email_sent({ email: next }))
      close()
    } catch (failure) {
      const code =
        failure instanceof AuthRequestError ? failure.code : undefined
      const message =
        failure instanceof Error && failure.message
          ? stripSecurityCode(failure.message)
          : m.account_email_failed()
      if (code === SIGN_IN_AGAIN) setSignInAgain(true)
      else if (code === INVALID_PASSWORD) setPasswordError(message)
      else setEmailError(message)
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="grid gap-4" id="email">
      <EmailChangeOutcomeNotice />
      <FormField label={m.auth_email()} htmlFor="account-email" hint={hint}>
        <Input
          id="account-email"
          name="email"
          value={me.user.email}
          readOnly
          data-testid="account-email"
          className="text-text-secondary"
        />
      </FormField>
      {available && !open ? (
        <div>
          <Button
            type="button"
            variant="secondary"
            onClick={() => setOpen(true)}
            data-testid="account-email-open"
            className="w-full sm:w-auto"
          >
            {m.account_email_change()}
          </Button>
        </div>
      ) : null}
      {available && open && signInAgain ? (
        <ReauthStep
          reauth={reauth}
          body={m.account_email_reauth_body()}
          returnHash="email"
          testId="account-email-reauth"
          onCancel={close}
        />
      ) : null}
      {available && open && !signInAgain ? (
        <form
          className="grid gap-4"
          data-testid="account-email-form"
          onSubmit={(event) => void submit(event)}
        >
          <FormField
            label={m.account_email_new()}
            htmlFor="account-new-email"
            error={emailError ?? undefined}
          >
            <Input
              id="account-new-email"
              name="newEmail"
              type="email"
              autoComplete="email"
              autoFocus
              required
              value={newEmail}
              disabled={pending}
              onChange={(event) => {
                setNewEmail(event.target.value)
                setEmailError(null)
              }}
            />
          </FormField>
          {hasPassword ? (
            <FormField
              label={m.account_password_current()}
              htmlFor="account-email-password"
              error={passwordError ?? undefined}
            >
              <PasswordInput
                id="account-email-password"
                name="currentPassword"
                autoComplete="current-password"
                required
                value={password}
                disabled={pending}
                onChange={(event) => {
                  setPassword(event.target.value)
                  setPasswordError(null)
                }}
              />
            </FormField>
          ) : null}
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              type="submit"
              loading={pending}
              disabled={!newEmail.trim()}
              data-testid="account-email-submit"
              className="w-full sm:w-auto"
            >
              {m.account_email_send()}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={pending}
              onClick={close}
              className="w-full sm:w-auto"
            >
              {m.shared_cancel()}
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  )
}
