import { Button } from '#/components/ui/button'
import { Hint } from '#/components/ui/tooltip'
import { SettingsSection } from '#/components/ui/settings-section'
import type { PersonDetail } from '#/features/agency/queries'
import { m } from '#/paraglide/messages'

import { ActionRow } from './action-row'
import type { PersonDialog } from './person-dialogs'

/**
 * Block, unblock and delete. Blocking is reversible and keeps everything the
 * person had; deleting is not. Both are refused for yourself and for the last
 * active agency admin, and the control says why.
 */
export function DangerSection({
  person,
  isSelf,
  protectedAdmin,
  selfReason,
  lastAdminReason,
  onOpen,
}: {
  person: PersonDetail
  isSelf: boolean
  protectedAdmin: boolean
  selfReason: string
  lastAdminReason: string
  onOpen: (next: PersonDialog) => void
}) {
  const reason = isSelf
    ? selfReason
    : protectedAdmin
      ? lastAdminReason
      : undefined
  const blocked = person.blocked !== null
  return (
    <SettingsSection
      id="person-danger"
      title={m.agency_person_danger_title()}
      description={m.agency_person_danger_description()}
      danger
    >
      <ActionRow
        testId="person-block-row"
        title={
          blocked
            ? m.agency_person_unblock_confirm({ name: person.name })
            : m.agency_person_block_confirm({ name: person.name })
        }
        description={
          blocked
            ? m.agency_person_unblock_summary()
            : m.agency_person_block_summary()
        }
        action={
          <Hint label={reason} wrapDisabled>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={Boolean(reason)}
              onClick={() => onOpen({ kind: blocked ? 'unblock' : 'block' })}
              data-testid={blocked ? 'person-unblock' : 'person-block'}
            >
              {blocked
                ? m.agency_person_unblock_action()
                : m.agency_person_block_action()}
            </Button>
          </Hint>
        }
      />
      <ActionRow
        danger
        testId="person-delete-row"
        title={m.agency_person_delete_row_title()}
        description={m.agency_person_delete_row_description()}
        action={
          <Hint label={isSelf ? selfReason : reason} wrapDisabled>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={Boolean(reason)}
              onClick={() => onOpen({ kind: 'delete' })}
              className="text-text-error"
              data-testid="person-delete"
            >
              {m.agency_person_delete_confirm()}
            </Button>
          </Hint>
        }
      />
    </SettingsSection>
  )
}
