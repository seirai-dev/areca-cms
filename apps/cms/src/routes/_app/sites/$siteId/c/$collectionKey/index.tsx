import { createFileRoute } from '@tanstack/react-router'

import { ContentPage } from '#/components/content/content-page'

export const Route = createFileRoute('/_app/sites/$siteId/c/$collectionKey/')({
  component: CollectionPage,
})

/** Same Content screen as `/sites/$siteId`, with this collection selected. */
function CollectionPage() {
  const { siteId, collectionKey } = Route.useParams()
  const { me, site } = Route.useRouteContext()
  return (
    <ContentPage
      siteId={siteId}
      organizationId={site.organizationId}
      me={me}
      collectionKey={collectionKey}
    />
  )
}
