import { createFileRoute, redirect } from '@tanstack/react-router'

/** Legacy: `/sites/$siteId/media` → Library. */
export const Route = createFileRoute('/_app/sites/$siteId/media')({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: '/sites/$siteId/library',
      params: { siteId: params.siteId },
      replace: true,
    })
  },
})
