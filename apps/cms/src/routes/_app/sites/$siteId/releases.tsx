import { createFileRoute, redirect } from '@tanstack/react-router'

/** Legacy: `/sites/$siteId/releases` → the Go‑live panel on the Overview. */
export const Route = createFileRoute('/_app/sites/$siteId/releases')({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: '/sites/$siteId',
      params: { siteId: params.siteId },
      search: { panel: 'golive' },
      replace: true,
    })
  },
})
