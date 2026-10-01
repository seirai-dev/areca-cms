import { createFileRoute } from '@tanstack/react-router'

import { CollectionScreen } from '#/features/collection/collection-screen'

/** `/sites/$siteId/c/$collectionKey`: one collection's entries. */
export const Route = createFileRoute('/_app/sites/$siteId/c/$collectionKey/')({
  component: CollectionPage,
})

function CollectionPage() {
  const { collectionKey } = Route.useParams()
  const { me, site } = Route.useRouteContext()
  return <CollectionScreen me={me} site={site} collectionKey={collectionKey} />
}
