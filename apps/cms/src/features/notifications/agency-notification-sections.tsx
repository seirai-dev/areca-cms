import { QueryError } from '#/components/ui/query-error'
import { SettingsSection } from '#/components/ui/settings-section'
import { Skeleton } from '#/components/ui/skeleton'
import type { NotificationRole } from '#/lib/notifications'
import { m } from '#/paraglide/messages'

import { NotificationRulesMatrix } from './notification-rules-matrix'
import { useAgencyNotificationRules } from './use-notification-rules'

const CLIENT_ROLES: NotificationRole[] = ['owner', 'editor']
const AGENCY_ROLES: NotificationRole[] = ['agency']

/**
 * Agency → Mail: the defaults every client starts from. A required email
 * here cannot be turned off by that client's owners or editors.
 */
export function AgencyClientDefaultsSection() {
  const { query, setRule } = useAgencyNotificationRules()
  return (
    <SettingsSection
      id="client-notifications"
      title={m.notifications_agency_clients_title()}
      description={m.notifications_agency_clients_description()}
    >
      {query.isError ? (
        <QueryError title={m.notifications_load_error()} query={query} />
      ) : query.isPending ? (
        <Skeleton className="h-64 rounded-control" />
      ) : (
        <NotificationRulesMatrix
          matrix={query.data.clients}
          roles={CLIENT_ROLES}
          onChange={setRule}
        />
      )}
    </SettingsSection>
  )
}

/** Agency → Mail: what agency admins hear about across every client. */
export function AgencyAlertsSection() {
  const { query, setRule } = useAgencyNotificationRules()
  return (
    <SettingsSection
      id="agency-alerts"
      title={m.notifications_agency_alerts()}
      description={m.notifications_agency_alerts_description()}
    >
      {query.isError ? (
        <QueryError title={m.notifications_load_error()} query={query} />
      ) : query.isPending ? (
        <Skeleton className="h-32 rounded-control" />
      ) : (
        <NotificationRulesMatrix
          matrix={query.data.agency}
          roles={AGENCY_ROLES}
          onChange={setRule}
        />
      )}
    </SettingsSection>
  )
}
