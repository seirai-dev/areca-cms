import { Hint } from '#/components/ui/tooltip'
import { Button } from '#/components/ui/button'
import { SettingsSection } from '#/components/ui/settings-section'
import type { PersonDetail } from '#/features/agency/queries'
import { m } from '#/paraglide/messages'

import { ActionRow } from './action-row'
import type { PersonDialog } from './person-dialogs'

/** Two-factor, sessions and the password, with the actions an admin can take. */
export function SecuritySection({
  person,
  isSelf,
  onOpen,
}: {
  person: PersonDetail
  isSelf: boolean
  onOpen: (next: PersonDialog) => void
}) {
  if (isSelf) {
    return (
      <SettingsSection
        id="person-security"
        title={m.agency_person_security_title()}
        description={m.agency_person_security_description()}
      >
        <p className="text-callout text-text-secondary">
          {m.agency_person_security_self()}
        </p>
      </SettingsSection>
    )
  }

  const sessions = person.activeSessions
  return (
    <SettingsSection
      id="person-security"
      title={m.agency_person_security_title()}
      description={m.agency_person_security_description()}
    >
      <ActionRow
        testId="person-2fa-row"
        title={
          person.twoFactorEnabled
            ? m.agency_person_2fa_title_on()
            : m.agency_person_2fa_title_off()
        }
        description={
          person.twoFactorEnabled
            ? m.agency_person_2fa_description_on()
            : m.agency_person_2fa_description_off()
        }
        action={
          <Hint
            label={
              person.twoFactorEnabled
                ? undefined
                : m.agency_person_2fa_already_off()
            }
            wrapDisabled
          >
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!person.twoFactorEnabled}
              onClick={() => onOpen({ kind: 'reset-2fa' })}
              data-testid="person-reset-2fa"
            >
              {m.agency_person_reset_2fa_action()}
            </Button>
          </Hint>
        }
      />
      <ActionRow
        testId="person-sessions-row"
        title={
          sessions === 1
            ? m.agency_person_sessions_one()
            : m.agency_person_sessions({ count: sessions })
        }
        description={m.agency_person_sessions_description()}
        action={
          <Hint
            label={sessions > 0 ? undefined : m.agency_person_sessions_none()}
            wrapDisabled
          >
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={sessions === 0}
              onClick={() => onOpen({ kind: 'sign-out' })}
              data-testid="person-sign-out"
            >
              {m.agency_person_sign_out_action()}
            </Button>
          </Hint>
        }
      />
      <ActionRow
        testId="person-password-row"
        title={m.agency_person_password_title()}
        description={
          person.hasPassword
            ? m.agency_person_password_description()
            : m.agency_person_password_description_sso()
        }
        action={
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOpen({ kind: 'reset-password' })}
            data-testid="person-reset-password"
          >
            {m.agency_people_reset_action()}
          </Button>
        }
      />
    </SettingsSection>
  )
}
