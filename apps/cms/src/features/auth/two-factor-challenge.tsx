import * as React from 'react'

import { Button } from '#/components/ui/button'
import { FormField } from '#/components/ui/form-field'
import { Input } from '#/components/ui/input'
import { m } from '#/paraglide/messages'

import { AuthError } from './auth-shell'

/**
 * The second step of sign-in for accounts with two-factor: an authenticator
 * code, or a backup code when the phone is lost.
 */
export function TwoFactorChallenge({
  onSubmit,
  onCancel,
  error,
  pending,
  ready,
}: {
  onSubmit: (code: string, kind: 'totp' | 'backup') => void
  onCancel: () => void
  error: string | null
  pending: boolean
  ready: boolean
}) {
  const [code, setCode] = React.useState('')
  const [kind, setKind] = React.useState<'totp' | 'backup'>('totp')
  const backup = kind === 'backup'

  return (
    <form
      className="grid gap-4"
      method="post"
      data-testid="two-factor-form"
      data-ready={ready ? 'true' : 'false'}
      onSubmit={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onSubmit(code, kind)
      }}
    >
      <FormField
        label={
          backup ? m.auth_two_factor_backup_code() : m.auth_two_factor_code()
        }
        htmlFor="two-factor-code"
        hint={
          backup
            ? m.auth_two_factor_backup_hint()
            : m.auth_two_factor_code_hint()
        }
      >
        <Input
          key={kind}
          id="two-factor-code"
          name="code"
          inputSize="lg"
          inputMode={backup ? 'text' : 'numeric'}
          autoComplete="one-time-code"
          autoCapitalize="none"
          spellCheck={false}
          autoFocus
          required
          value={code}
          onChange={(event) => setCode(event.target.value)}
        />
      </FormField>
      {error ? <AuthError>{error}</AuthError> : null}
      <Button
        type="submit"
        variant="accent"
        size="lg"
        className="w-full"
        disabled={!ready}
        loading={pending}
      >
        {m.auth_two_factor_verify()}
      </Button>
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          className="text-callout text-text-secondary underline-offset-4 hover:text-text-primary hover:underline"
          data-testid="two-factor-toggle"
          onClick={() => {
            setKind(backup ? 'totp' : 'backup')
            setCode('')
          }}
        >
          {backup
            ? m.auth_two_factor_use_app()
            : m.auth_two_factor_use_backup()}
        </button>
        <button
          type="button"
          className="text-callout text-text-secondary underline-offset-4 hover:text-text-primary hover:underline"
          onClick={onCancel}
        >
          {m.auth_two_factor_back()}
        </button>
      </div>
    </form>
  )
}
