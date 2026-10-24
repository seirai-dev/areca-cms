import * as React from 'react'
import { toast } from 'sonner'

import { Button } from '#/components/ui/button'
import { FormField } from '#/components/ui/form-field'
import { SettingsSection } from '#/components/ui/settings-section'
import { PasswordInput } from '#/features/auth/password-input'
import { authClient } from '#/lib/auth-client'
import { m } from '#/paraglide/messages'

import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  validatePasswordChange,
} from './account-logic'
import type { PasswordChangeError, PasswordChangeFields } from './account-logic'

type FieldName = keyof PasswordChangeFields

const EMPTY_FIELDS: PasswordChangeFields = {
  current: '',
  next: '',
  confirm: '',
}

function validationCopy(error: PasswordChangeError) {
  switch (error) {
    case 'current_required':
      return m.account_password_error_current()
    case 'too_short':
      return m.account_password_error_short({ count: PASSWORD_MIN_LENGTH })
    case 'too_long':
      return m.account_password_error_long({ count: PASSWORD_MAX_LENGTH })
    case 'mismatch':
      return m.account_password_error_mismatch()
  }
}

/**
 * Change password, for accounts that sign in with one. Other sessions are
 * signed out by Better Auth (`revokeOtherSessions`); this one stays.
 */
export function PasswordSection() {
  const [fields, setFields] = React.useState(EMPTY_FIELDS)
  const [messages, setMessages] = React.useState<
    Partial<Record<FieldName, string>>
  >({})
  const [pending, setPending] = React.useState(false)
  const [formError, setFormError] = React.useState<string | null>(null)

  function update(name: FieldName, value: string) {
    setFields((prev) => ({ ...prev, [name]: value }))
    setMessages((prev) => {
      const next = { ...prev }
      delete next[name]
      return next
    })
    setFormError(null)
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const errors = validatePasswordChange(fields)
    const found: Partial<Record<FieldName, string>> = {}
    for (const [name, code] of Object.entries(errors) as Array<
      [FieldName, PasswordChangeError]
    >) {
      found[name] = validationCopy(code)
    }
    setMessages(found)
    setFormError(null)
    if (Object.keys(found).length > 0) return

    setPending(true)
    const result = await authClient.changePassword({
      currentPassword: fields.current,
      newPassword: fields.next,
      revokeOtherSessions: true,
    })
    setPending(false)
    if (result.error) {
      if (result.error.code === 'INVALID_PASSWORD') {
        setMessages({ current: m.account_password_error_wrong() })
      } else {
        setFormError(result.error.message ?? m.account_password_failed())
      }
      return
    }
    setFields(EMPTY_FIELDS)
    toast.success(m.account_password_changed())
  }

  return (
    <SettingsSection
      id="password"
      title={m.account_password_title()}
      description={m.account_password_description()}
    >
      <form
        className="grid gap-4"
        data-testid="change-password-form"
        onSubmit={(event) => void submit(event)}
      >
        <FormField
          label={m.account_password_current()}
          htmlFor="current-password"
          error={messages.current}
        >
          <PasswordInput
            id="current-password"
            name="currentPassword"
            autoComplete="current-password"
            value={fields.current}
            disabled={pending}
            onChange={(event) => update('current', event.target.value)}
          />
        </FormField>
        <FormField
          label={m.account_password_new()}
          htmlFor="new-password"
          error={messages.next}
          hint={m.account_password_min_hint({ count: PASSWORD_MIN_LENGTH })}
        >
          <PasswordInput
            id="new-password"
            name="newPassword"
            autoComplete="new-password"
            value={fields.next}
            disabled={pending}
            onChange={(event) => update('next', event.target.value)}
          />
        </FormField>
        <FormField
          label={m.account_password_confirm()}
          htmlFor="confirm-password"
          error={messages.confirm}
        >
          <PasswordInput
            id="confirm-password"
            name="confirmPassword"
            autoComplete="new-password"
            value={fields.confirm}
            disabled={pending}
            onChange={(event) => update('confirm', event.target.value)}
          />
        </FormField>
        {formError ? (
          <p role="alert" className="text-callout text-text-error">
            {formError}
          </p>
        ) : null}
        <div>
          <Button
            type="submit"
            variant="secondary"
            loading={pending}
            data-testid="change-password-submit"
            className="w-full sm:w-auto"
          >
            {m.account_password_change()}
          </Button>
        </div>
      </form>
    </SettingsSection>
  )
}
