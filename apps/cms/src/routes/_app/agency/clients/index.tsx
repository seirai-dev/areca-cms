import { createFileRoute } from '@tanstack/react-router'
import { z } from '#/lib/zod'

import { ClientsScreen } from '#/features/agency/clients-screen'

/** `/agency/clients?new=1`: every client; `new` opens the New client sheet. */
export const Route = createFileRoute('/_app/agency/clients/')({
  validateSearch: z.object({
    new: z.coerce.number().optional().catch(undefined),
  }),
  component: ClientsPage,
})

function ClientsPage() {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  return (
    <ClientsScreen
      createOpen={search.new === 1}
      onCreateOpenChange={(open) =>
        void navigate({
          search: (prev) => ({ ...prev, new: open ? 1 : undefined }),
          replace: true,
        })
      }
    />
  )
}
