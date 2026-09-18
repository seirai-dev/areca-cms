import { createFileRoute } from '@tanstack/react-router'

import { ContentPage } from '#/components/content/content-page'

export const Route = createFileRoute('/_app/sites/$siteId/')({
  component: SiteContentPage,
})

/** `/sites/$siteId` selects the first collection without changing the URL. */
function SiteContentPage() {
  const { siteId } = Route.useParams()
  const { me, site } = Route.useRouteContext()
  return (
    <ContentPage
      siteId={siteId}
      organizationId={site.organizationId}
      me={me}
    />
  )
}
