import * as React from 'react'
import { Link } from '@tanstack/react-router'
import { EnvelopeSimple } from '@phosphor-icons/react'

import { Button } from '#/components/ui/button'
import { FormField } from '#/components/ui/form-field'
import { Input } from '#/components/ui/input'
import { authClient } from '#/lib/auth-client'
import { m } from '#/paraglide/messages'

import { AuthError, AuthHeading, AuthShell } from './auth-shell'
import { passwordResetRateLimited } from './password-reset-logic'
import { useHydrated } from './use-auth-forms'

/**
 * `/forgot-password`: an email field and "Send reset link". The success state
 * is the same whether or not an account exists, so the form cannot be used to
 * discover which addresses have one. Only a rate-limit answer is shown as an
 * error, because it says nothing about the address.
 */
export function ForgotPasswordScreen({ available }: { available: boolean }) {
  const ready = useHydrated()
  const [email, setEmail] = React.useState('')
  const [sentTo, setSentTo] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [pending, setPending] = React.useState(false)

  if (!available) {
    return (
      <AuthShell>
        <div
          className="grid justify-items-center gap-5 text-center"
          data-testid="forgot-password-unavailable"
        >
          <span
            aria-hidden="true"
            className="grid size-14 place-content-center rounded-[18px] bg-background-subtle text-icon-muted ring-8 ring-background-subtle/50"
          >
            <EnvelopeSimple weight="duotone" className="size-7" />
          </span>
          <AuthHeading
            title={m.auth_forgot_unavailable_title()}
            description={m.auth_forgot_unavailable_body()}
          />
          <Button asChild variant="outline" size="lg" className="w-full">
            <Link to="/login">{m.auth_forgot_back()}</Link>
          </Button>
        </div>
      </AuthShell>
    )
  }

  async function submit() {
    setPending(true)
    setError(null)
    try {
      const result = await authClient.requestPasswordReset({
        email,
        redirectTo: '/reset-password',
      })
      if (result.error && passwordResetRateLimited(result.error)) {
        setError(result.error.message ?? m.auth_forgot_could_not_send())
        return
      }
      setSentTo(email)
    } catch {
      // A network failure says nothing about the address, so it is not hidden
      // behind the success state: the person can try again.
      setError(m.auth_forgot_could_not_send())
    } finally {
      setPending(false)
    }
  }

  const back = (
    <Link
      to="/login"
      className="font-medium text-text-accent underline-offset-4 hover:underline"
      data-testid="forgot-password-back"
    >
      {m.auth_forgot_back()}
    </Link>
  )

  if (sentTo !== null) {
    return (
      <AuthShell footer={back}>
        <div
          className="grid justify-items-center gap-5 text-center"
          data-testid="forgot-password-sent"
        >
          <span
            aria-hidden="true"
            className="grid size-14 place-content-center rounded-[18px] bg-status-success-bg text-icon-success ring-8 ring-status-success-bg/50"
          >
            <EnvelopeSimple weight="duotone" className="size-7" />
          </span>
          <AuthHeading
            title={m.auth_forgot_sent_title()}
            description={m.auth_forgot_sent_body({ email: sentTo })}
          />
        </div>
      </AuthShell>
    )
  }

  return (
    <AuthShell footer={back}>
      <AuthHeading
        title={m.auth_forgot_title()}
        description={m.auth_forgot_subtitle()}
      />
      <form
        className="mt-7 grid gap-4"
        method="post"
        data-testid="forgot-password-form"
        data-ready={ready ? 'true' : 'false'}
        onSubmit={(event) => {
          event.preventDefault()
          event.stopPropagation()
          void submit()
        }}
      >
        <FormField label={m.auth_email()} htmlFor="email">
          <Input
            id="email"
            name="email"
            type="email"
            inputSize="lg"
            autoComplete="email"
            autoFocus
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
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
          {m.auth_forgot_send()}
        </Button>
      </form>
    </AuthShell>
  )
}
