import { Outlet, createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_app/sites/$siteId/c/$collectionKey')({
  component: CollectionLayout,
})

function CollectionLayout() {
  return <Outlet />
}
