import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'

import {
  CLIENT_TABS,
  LegacyClientDetail,
} from '#/features/agency/legacy-client-detail'

/** `/agency/clients/$orgId?tab=sites|people|deployment|settings`. */
export const Route = createFileRoute('/_app/agency/clients/$orgId')({
  validateSearch: z.object({
    tab: z.enum(CLIENT_TABS).optional().catch(undefined),
  }),
  component: ClientPage,
})

function ClientPage() {
  const { orgId } = Route.useParams()
  const { tab } = Route.useSearch()
  const navigate = Route.useNavigate()
  return (
    <LegacyClientDetail
      orgId={orgId}
      tab={tab ?? 'sites'}
      onTabChange={(next) =>
        void navigate({
          search: (prev) => ({ ...prev, tab: next === 'sites' ? undefined : next }),
          replace: true,
        })
      }
    />
  )
}
