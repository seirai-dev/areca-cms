import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'

import { AgencyActivityScreen } from '#/features/activity/agency-activity-screen'

/** `/agency/activity?client=…`: the global audit log. */
export const Route = createFileRoute('/_app/agency/activity')({
  validateSearch: z.object({
    client: z.string().optional().catch(undefined),
  }),
  component: AgencyActivityPage,
})

function AgencyActivityPage() {
  const { client } = Route.useSearch()
  const navigate = Route.useNavigate()
  return (
    <AgencyActivityScreen
      clientId={client}
      onClientChange={(next) =>
        void navigate({ search: { client: next }, replace: true })
      }
    />
  )
}
