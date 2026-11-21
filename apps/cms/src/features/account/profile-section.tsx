import * as React from 'react'
import { useRouter } from '@tanstack/react-router'
import { toast } from 'sonner'

import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { SettingsSection } from '#/components/ui/settings-section'
import { PERSON_NAME_MAX_LENGTH } from '#/lib/person-name'
import type { ReauthProvider } from '#/lib/reauth-provider'
import { m } from '#/paraglide/messages'
import { updateMyNameFn } from '#/server/fn/account'
import type { Me } from '#/server/fn/me'

import { canSaveName } from './account-logic'
import { ProfileEmail } from './profile-email'

/**
 * Profile: the display name is editable (Enter saves, Escape reverts). The
 * email is shown read-only; agency admins can ask to change it
 * (`ProfileEmail`). Saving the name refreshes the router, which drops the
 * cached `me`, so the navbar account menu shows the new name without a reload.
 */
export function ProfileSection({
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
      <ProfileEmail
        me={me}
        hasPassword={hasPassword}
        reauth={reauth}
        mailConfigured={mailConfigured}
      />
    </SettingsSection>
  )
}
