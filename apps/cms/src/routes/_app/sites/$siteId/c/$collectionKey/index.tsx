import { createFileRoute } from '@tanstack/react-router'

import { LegacyCollection } from '#/features/collection/legacy-collection'

/** `/sites/$siteId/c/$collectionKey`: one collection's entries. */
export const Route = createFileRoute('/_app/sites/$siteId/c/$collectionKey/')({
  component: CollectionPage,
})

function CollectionPage() {
  const { collectionKey } = Route.useParams()
  const { me, site } = Route.useRouteContext()
  return <LegacyCollection me={me} site={site} collectionKey={collectionKey} />
}
