import { useQuery } from '@tanstack/react-query'

import { adminQueryKeys } from '#/components/admin/helpers'
import { Card } from '#/components/ui/card'
import { PageHeader } from '#/components/ui/page-header'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import { m } from '#/paraglide/messages'
import { listOrganizationsFn } from '#/server/fn/admin'

import { ActivityList } from './activity-list'

const ALL = 'all'

/**
 * `/agency/activity` (brief §3.7, §3.11): the full-page activity list with a
 * client filter, all clients by default.
 */
export function AgencyActivityScreen({
  clientId,
  onClientChange,
}: {
  clientId: string | undefined
  onClientChange: (clientId: string | undefined) => void
}) {
  const clients = useQuery({
    queryKey: adminQueryKeys.organizations,
    queryFn: () => listOrganizationsFn(),
  })

  return (
    <div className="grid gap-8" data-testid="agency-activity">
      <PageHeader
        title={m.activity_title()}
        description={m.activity_agency_description()}
        actions={
          <Select
            value={clientId ?? ALL}
            onValueChange={(value) => onClientChange(value === ALL ? undefined : value)}
          >
            <SelectTrigger
              aria-label={m.activity_filter_client()}
              className="min-w-48"
              data-testid="activity-client-filter"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              <SelectItem value={ALL}>{m.activity_all_clients()}</SelectItem>
              {(clients.data ?? []).map((client) => (
                <SelectItem key={client.id} value={client.id}>
                  {client.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />
      <Card className="p-6">
        <ActivityList key={clientId ?? ALL} organizationId={clientId} />
      </Card>
    </div>
  )
}
