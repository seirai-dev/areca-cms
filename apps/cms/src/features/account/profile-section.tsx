import * as React from 'react'
import { useRouter } from '@tanstack/react-router'
import { toast } from 'sonner'

import { Button } from '#/components/ui/button'
import { FormField } from '#/components/ui/form-field'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { SettingsSection } from '#/components/ui/settings-section'
import { PERSON_NAME_MAX_LENGTH } from '#/lib/person-name'
import { m } from '#/paraglide/messages'
import { updateMyNameFn } from '#/server/fn/account'
import type { Me } from '#/server/fn/me'

import { canSaveName } from './account-logic'

/**
 * Profile: the display name is editable (Enter saves, Escape reverts); the
 * email is read-only. Saving refreshes the router, which drops the cached
 * `me`, so the navbar account menu shows the new name without a reload.
 */
export function ProfileSection({ me }: { me: Me }) {
  const router = useRouter()
  const [saved, setSaved] = React.useState(me.user.name)
  const [draft, setDraft] = React.useState(me.user.name)
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const canSave = canSaveName(draft, saved) && !pending

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canSave) return
    const name = draft.trim()
    setPending(true)
    setError(null)
    try {
      await updateMyNameFn({ data: { name } })
      setSaved(name)
      setDraft(name)
      toast.success(m.account_name_saved())
      await router.invalidate()
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : m.account_name_failed(),
      )
    } finally {
      setPending(false)
    }
  }

  return (
    <SettingsSection
      id="profile"
      title={m.account_profile_title()}
      description={m.account_profile_description()}
    >
      <form
        className="grid gap-2"
        data-testid="account-name-form"
        onSubmit={(event) => void save(event)}
      >
        <Label htmlFor="account-name">{m.auth_name()}</Label>
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
          <Input
            id="account-name"
            name="name"
            autoComplete="name"
            maxLength={PERSON_NAME_MAX_LENGTH}
            value={draft}
            disabled={pending}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'account-name-error' : undefined}
            data-testid="account-name-input"
            onChange={(event) => {
              setDraft(event.target.value)
              setError(null)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setDraft(saved)
                setError(null)
              }
            }}
          />
          <Button
            type="submit"
            variant="secondary"
            disabled={!canSave}
            loading={pending}
            data-testid="account-name-save"
            className="w-full sm:w-auto"
          >
            {m.account_name_save()}
          </Button>
        </div>
        {error ? (
          <p
            id="account-name-error"
            role="alert"
            className="text-callout text-text-error"
          >
            {error}
          </p>
        ) : null}
      </form>
      <FormField
        label={m.auth_email()}
        htmlFor="account-email"
        hint={m.account_email_note()}
      >
        <Input
          id="account-email"
          name="email"
          value={me.user.email}
          readOnly
          data-testid="account-email"
          className="text-text-secondary"
        />
      </FormField>
    </SettingsSection>
  )
}
