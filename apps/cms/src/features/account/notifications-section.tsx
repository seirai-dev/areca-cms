import type { ReactNode } from 'react'
import { LockSimple, WarningCircle } from '@phosphor-icons/react'

import { QueryError } from '#/components/ui/query-error'
import { InsetGroup, InsetList, InsetRow } from '#/components/ui/inset-list'
import { SettingsSection } from '#/components/ui/settings-section'
import { Skeleton } from '#/components/ui/skeleton'
import { Switch } from '#/components/ui/switch'
import {
  eventDescription,
  eventLabel,
  roleLabel,
} from '#/features/notifications/notification-copy'
import type { PreferenceChange } from '#/features/notifications/notification-rules-logic'
import {
  useMyNotifications,
  useSetMyNotification,
} from '#/features/notifications/use-notification-rules'
import type {
  MyNotifications,
  NotificationRole,
  PreferenceRow,
} from '#/lib/notifications'
import { m } from '#/paraglide/messages'

/**
 * Account → Notifications (`#notifications`): your own email switches, one
 * group per organization and one for agency alerts. A required email is on
 * and its switch is disabled, with who requires it.
 */
export function NotificationsSection() {
  const query = useMyNotifications()
  const setPreference = useSetMyNotification()
  return (
    <SettingsSection
      id="notifications"
      bare
      title={m.notifications_section_title()}
      description={m.notifications_section_description()}
    >
      {query.isError ? (
        <QueryError
          title={m.notifications_load_error()}
          error={query.error}
          onRetry={() => void query.refetch()}
          retrying={query.isFetching}
        />
      ) : query.isPending ? (
        <div className="grid gap-4" aria-busy="true">
          <Skeleton className="h-40 rounded-card" />
        </div>
      ) : (
        <NotificationGroups
          data={query.data}
          onSet={(change) => setPreference.mutate(change)}
        />
      )}
    </SettingsSection>
  )
}

function NotificationGroups({
  data,
  onSet,
}: {
  data: MyNotifications
  onSet: (change: PreferenceChange) => void
}) {
  return (
    <div className="grid gap-6">
      {!data.emailVerified ? (
        <Notice>{m.notifications_unverified()}</Notice>
      ) : null}
      {!data.mailConfigured ? (
        <Notice>{m.notifications_mail_off()}</Notice>
      ) : null}

      {data.orgs.map((org) => (
        <InsetGroup
          key={org.organizationId}
          title={m.notifications_group_title({
            org: org.orgName,
            role: roleLabel(org.role),
          })}
        >
          <PreferenceList
            rows={org.events}
            role={org.role}
            organizationId={org.organizationId}
            idPrefix={org.organizationId}
            orgName={org.orgName}
            agencyName={data.agencyName}
            onSet={onSet}
          />
        </InsetGroup>
      ))}

      {data.agency ? (
        <InsetGroup title={m.notifications_agency_alerts()}>
          <PreferenceList
            rows={data.agency.events}
            role="agency"
            organizationId={null}
            idPrefix="agency"
            orgName={null}
            agencyName={data.agencyName}
            onSet={onSet}
          />
        </InsetGroup>
      ) : null}
    </div>
  )
}

function PreferenceList({
  rows,
  role,
  organizationId,
  idPrefix,
  orgName,
  agencyName,
  onSet,
}: {
  rows: PreferenceRow[]
  role: NotificationRole
  organizationId: string | null
  idPrefix: string
  orgName: string | null
  agencyName: string
  onSet: (change: PreferenceChange) => void
}) {
  return (
    <InsetList>
      {rows.map((row) => {
        const label = eventLabel(row.event)
        const locked = row.lockedBy !== null
        const requiredBy =
          row.lockedBy === 'agency' ? agencyName : (orgName ?? agencyName)
        return (
          <InsetRow
            key={row.event}
            title={label}
            subtitle={eventDescription(row.event)}
            wrapSubtitle
            trailing={
              <span className="flex items-center gap-3">
                {locked ? (
                  <span className="inline-flex items-center gap-1 text-caption font-normal text-text-muted">
                    <LockSimple aria-hidden="true" className="size-3.5" />
                    {m.notifications_required_by({ name: requiredBy })}
                  </span>
                ) : null}
                <Switch
                  aria-label={m.notifications_switch_aria({
                    event: label,
                    role: roleLabel(role),
                  })}
                  data-testid={`notif-${idPrefix}-${row.event}`}
                  checked={row.enabled}
                  disabled={locked}
                  onCheckedChange={(enabled) =>
                    onSet({ organizationId, event: row.event, enabled })
                  }
                />
              </span>
            }
          />
        )
      })}
    </InsetList>
  )
}

function Notice({ children }: { children: ReactNode }) {
  return (
    <div
      role="status"
      className="flex items-start gap-3 px-4 py-3.5 surface-card"
    >
      <span className="mt-0.5 grid size-7 shrink-0 place-content-center rounded-full bg-status-warning-bg text-icon-warning">
        <WarningCircle weight="fill" className="size-[18px]" />
      </span>
      <p className="text-callout text-text-secondary">{children}</p>
    </div>
  )
}
