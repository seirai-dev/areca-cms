import { createFileRoute } from '@tanstack/react-router'
import { optionalParam, z } from '#/lib/search-params'

import { ClientScreen } from '#/features/agency/client-screen'
import { CLIENT_TABS } from '#/features/agency/client-tabs'

/**
 * `/agency/clients/$orgId?tab=sites|people|deployment|settings&new=1`.
 * `new=1` opens the New site sheet (the site picker and the switcher link
 * here).
 */
export const Route = createFileRoute('/_app/agency/clients/$orgId')({
  validateSearch: z.object({
    tab: optionalParam(z.enum(CLIENT_TABS)),
    new: optionalParam(z.coerce.number()),
  }),
  component: ClientPage,
})

function ClientPage() {
  const { orgId } = Route.useParams()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  return (
    <ClientScreen
      orgId={orgId}
      tab={search.tab ?? 'sites'}
      newSiteOpen={search.new === 1}
      onTabChange={(next) =>
        void navigate({
          search: (prev) => ({
            ...prev,
            tab: next === 'sites' ? undefined : next,
            new: undefined,
          }),
          replace: true,
        })
      }
      onNewSiteOpenChange={(open) =>
        void navigate({
          search: (prev) => ({
            ...prev,
            tab: undefined,
            new: open ? 1 : undefined,
          }),
          replace: true,
        })
      }
    />
  )
}
