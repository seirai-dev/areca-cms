import { createFileRoute } from '@tanstack/react-router'

import { LegacyClients } from '#/features/agency/legacy-clients'

/** `/agency/clients`: every client. */
export const Route = createFileRoute('/_app/agency/clients/')({
  component: LegacyClients,
})
