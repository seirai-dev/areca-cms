import { createFileRoute } from '@tanstack/react-router'

import { LibraryScreen } from '#/features/library/library-screen'

/** `/sites/$siteId/library`: media shared by the client's sites (brief §3.8). */
export const Route = createFileRoute('/_app/sites/$siteId/library')({
  component: LibraryPage,
})

function LibraryPage() {
  const { site, me } = Route.useRouteContext()
  return <LibraryScreen site={site} me={me} />
}
