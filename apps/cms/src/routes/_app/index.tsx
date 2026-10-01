import { createFileRoute, redirect } from '@tanstack/react-router'

import { resolveWorkspace } from '#/features/shell/resolve-workspace'
import { readLastSiteId } from '#/features/shell/last-site'

/**
 * `/` has no UI (brief §2): it sends you to the last site you used, else
 * your only site, else the Agency workspace (admins), else the site picker.
 */
export const Route = createFileRoute('/_app/')({
  beforeLoad: async ({ context }) => {
    const lastSiteId = await readLastSiteId()
    const target = resolveWorkspace(context.me, lastSiteId)
    if (target.kind === 'site') {
      throw redirect({
        to: '/sites/$siteId',
        params: { siteId: target.siteId },
        replace: true,
      })
    }
    if (target.kind === 'agency') {
      throw redirect({ to: '/agency', replace: true })
    }
    throw redirect({ to: '/sites', replace: true })
  },
})
