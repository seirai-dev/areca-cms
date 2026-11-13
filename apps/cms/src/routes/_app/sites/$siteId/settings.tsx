import { createFileRoute, redirect } from '@tanstack/react-router'
import { optionalParam, z } from '#/lib/search-params'

import { SiteSettingsScreen } from '#/features/site-settings/site-settings-screen'
import { SETTINGS_TABS } from '#/features/site-settings/settings-tabs'

/** `/sites/$siteId/settings?tab=…` (agency admins, brief §3.10). */
export const Route = createFileRoute('/_app/sites/$siteId/settings')({
  validateSearch: z.object({
    tab: optionalParam(z.enum(SETTINGS_TABS)),
  }),
  beforeLoad: ({ context, params }) => {
    if (!context.me.user.isAgencyAdmin) {
      throw redirect({
        to: '/sites/$siteId',
        params: { siteId: params.siteId },
      })
    }
  },
  component: SettingsPage,
})

function SettingsPage() {
  const { site } = Route.useRouteContext()
  const { tab } = Route.useSearch()
  const navigate = Route.useNavigate()
  return (
    <SiteSettingsScreen
      site={site}
      tab={tab ?? 'general'}
      onTabChange={(next) =>
        void navigate({
          search: (prev) => ({
            ...prev,
            tab: next === 'general' ? undefined : next,
          }),
          replace: true,
        })
      }
    />
  )
}
