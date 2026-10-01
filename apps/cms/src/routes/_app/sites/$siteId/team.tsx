import { createFileRoute, redirect } from '@tanstack/react-router'

/** Legacy: `/sites/$siteId/team` → People. */
export const Route = createFileRoute('/_app/sites/$siteId/team')({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: '/sites/$siteId/people',
      params: { siteId: params.siteId },
      replace: true,
    })
  },
})
