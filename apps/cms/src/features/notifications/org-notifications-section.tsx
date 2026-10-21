import { QueryError } from '#/components/ui/query-error'
import { SettingsSection } from '#/components/ui/settings-section'
import { Skeleton } from '#/components/ui/skeleton'
import { m } from '#/paraglide/messages'

import { NotificationRulesMatrix } from './notification-rules-matrix'
import { useOrgNotificationRules } from './use-notification-rules'

const ORG_ROLES: ('owner' | 'editor')[] = ['owner', 'editor']

/**
 * The organization's rules, edited by its owners and agency admins. Used on
 * Clients → Settings and on the site's People page. Changes save per switch.
 */
export function OrgNotificationsSection({
  organizationId,
  organizationName,
}: {
  organizationId: string
  organizationName: string
}) {
  const { query, setRule } = useOrgNotificationRules(organizationId)
  return (
    <SettingsSection
      title={m.notifications_org_title()}
      description={m.notifications_org_description({
        org: organizationName,
      })}
      data-testid="org-notifications"
    >
      {query.isError ? (
        <QueryError
          title={m.notifications_load_error()}
          error={query.error}
          onRetry={() => void query.refetch()}
          retrying={query.isFetching}
        />
      ) : query.isPending ? (
        <Skeleton className="h-64 rounded-control" />
      ) : (
        <NotificationRulesMatrix
          matrix={query.data}
          roles={ORG_ROLES}
          agencyName={query.data.agencyName}
          onChange={setRule}
        />
      )}
    </SettingsSection>
  )
}
