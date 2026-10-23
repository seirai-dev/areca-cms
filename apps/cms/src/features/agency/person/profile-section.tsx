import * as React from 'react'
import { toast } from 'sonner'

import { Button } from '#/components/ui/button'
import { FormField } from '#/components/ui/form-field'
import { Input } from '#/components/ui/input'
import { SettingsSection } from '#/components/ui/settings-section'
import { usePeopleMutations } from '#/features/agency/use-people-mutations'
import type { PersonDetail } from '#/features/agency/queries'
import { errorMessage } from '#/lib/admin/helpers'
import { m } from '#/paraglide/messages'

/** The display name. Saved explicitly; no e-mail is sent. */
export function ProfileSection({ person }: { person: PersonDetail }) {
  return (
    <SettingsSection
      id="person-profile"
      title={m.agency_person_profile_title()}
      description={m.agency_person_profile_description()}
    >
      <NameForm key={`${person.id}:${person.name}`} person={person} />
    </SettingsSection>
  )
}

/** Remounted when the saved name changes, so the field always starts from it. */
function NameForm({ person }: { person: PersonDetail }) {
  const mutations = usePeopleMutations()
  const [draft, setDraft] = React.useState(person.name)
  const trimmed = draft.trim()
  const dirty = trimmed !== '' && trimmed !== person.name

  async function save(event: React.FormEvent) {
    event.preventDefault()
    if (!dirty) return
    try {
      await mutations.rename.mutateAsync({ userId: person.id, name: trimmed })
      toast.success(m.agency_person_name_saved())
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  return (
    <form className="grid gap-3" onSubmit={save} data-testid="person-name-form">
      <FormField label={m.agency_person_name_label()} htmlFor="person-name">
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            id="person-name"
            autoComplete="off"
            maxLength={120}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            data-testid="person-name-input"
          />
          <Button
            type="submit"
            variant="secondary"
            disabled={!dirty}
            loading={mutations.rename.isPending}
            data-testid="person-name-save"
          >
            {m.agency_person_name_save()}
          </Button>
        </div>
      </FormField>
    </form>
  )
}
