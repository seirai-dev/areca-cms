import * as React from 'react'
import { Link } from '@tanstack/react-router'
import { LinkBreak } from '@phosphor-icons/react'

import { Button } from '#/components/ui/button'
import { FormField } from '#/components/ui/form-field'
import { authClient } from '#/lib/auth-client'
import { m } from '#/paraglide/messages'

import { AuthError, AuthHeading, AuthShell } from './auth-shell'
import { PasswordInput } from './password-input'
import {
  PASSWORD_MIN_LENGTH,
  passwordsMatch,
  resetTokenInvalid,
} from './password-reset-logic'
import { useHydrated } from './use-auth-forms'

type ResetState = 'form' | 'done' | 'invalid'

/**
 * `/reset-password?token=…`: choose a new password. A missing or spent token
 * gets the friendly card. Success signs every session out (the server revokes
 * them), so the next step is signing in with the new password.
 */
export function ResetPasswordScreen({ token }: { token: string | undefined }) {
  const ready = useHydrated()
  const [password, setPassword] = React.useState('')
  const [confirmation, setConfirmation] = React.useState('')
  const [mismatch, setMismatch] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [pending, setPending] = React.useState(false)
  const [state, setState] = React.useState<ResetState>(
    token ? 'form' : 'invalid',
  )

  if (state === 'invalid') {
    return <ResetInvalid />
  }

  async function submit() {
    if (!token) return
    if (!passwordsMatch(password, confirmation)) {
      setMismatch(true)
      return
    }
    setPending(true)
    setError(null)
    try {
      const result = await authClient.resetPassword({
        newPassword: password,
        token,
      })
      if (result.error) {
        if (resetTokenInvalid(result.error)) {
          setState('invalid')
        } else {
          setError(result.error.message ?? m.auth_reset_could_not_change())
        }
        return
      }
      setState('done')
    } catch {
      setError(m.auth_reset_could_not_change())
    } finally {
      setPending(false)
    }
  }

  if (state === 'done') {
    return (
      <AuthShell>
        <AuthHeading
          title={m.auth_reset_done_title()}
          description={m.auth_reset_done_body()}
        />
        <Button asChild size="lg" className="mt-7 w-full">
          <Link to="/login" data-testid="reset-password-sign-in">
            {m.auth_sign_in()}
          </Link>
        </Button>
      </AuthShell>
    )
  }

  return (
    <AuthShell>
      <AuthHeading
        title={m.auth_reset_title()}
        description={m.auth_reset_subtitle()}
      />
      <form
        className="mt-7 grid gap-4"
        method="post"
        data-testid="reset-password-form"
        data-ready={ready ? 'true' : 'false'}
        onSubmit={(event) => {
          event.preventDefault()
          event.stopPropagation()
          void submit()
        }}
      >
        <FormField
          label={m.auth_reset_new_password()}
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
            minLength={PASSWORD_MIN_LENGTH}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </FormField>
        <FormField
          label={m.auth_reset_confirm_password()}
          htmlFor="confirmation"
          error={mismatch ? m.auth_reset_mismatch() : undefined}
        >
          <PasswordInput
            id="confirmation"
            name="confirmation"
            inputSize="lg"
            autoComplete="new-password"
            required
            minLength={PASSWORD_MIN_LENGTH}
            value={confirmation}
            onChange={(event) => {
              setConfirmation(event.target.value)
              setMismatch(false)
            }}
          />
        </FormField>
        {error ? <AuthError>{error}</AuthError> : null}
        <Button
          type="submit"
          size="lg"
          className="mt-1 w-full"
          disabled={!ready}
          loading={pending}
        >
          {m.auth_reset_submit()}
        </Button>
      </form>
    </AuthShell>
  )
}

/** Expired, used or missing link: a friendly card with a way to ask again. */
function ResetInvalid() {
  return (
    <AuthShell>
      <div
        className="grid justify-items-center gap-5 text-center"
        data-testid="reset-password-invalid"
      >
        <span
          aria-hidden="true"
          className="grid size-14 place-content-center rounded-[18px] bg-background-subtle text-icon-muted ring-8 ring-background-subtle/50"
        >
          <LinkBreak weight="duotone" className="size-7" />
        </span>
        <AuthHeading
          title={m.auth_reset_invalid_title()}
          description={m.auth_reset_invalid_body()}
        />
        <Button asChild variant="outline" size="lg" className="w-full">
          <Link to="/forgot-password">{m.auth_reset_request_new()}</Link>
        </Button>
      </div>
    </AuthShell>
  )
}
