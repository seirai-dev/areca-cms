import { createFileRoute, redirect } from '@tanstack/react-router'

/** Legacy: `/sites/$siteId/activity` → the Activity panel on the Overview. */
export const Route = createFileRoute('/_app/sites/$siteId/activity')({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: '/sites/$siteId',
      params: { siteId: params.siteId },
      search: { panel: 'activity' },
      replace: true,
    })
  },
})
