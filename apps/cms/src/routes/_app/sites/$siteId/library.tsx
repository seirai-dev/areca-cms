import { createFileRoute } from '@tanstack/react-router'

import { LegacyLibrary } from '#/features/library/legacy-library'

/** `/sites/$siteId/library`: media shared by the client's sites. */
export const Route = createFileRoute('/_app/sites/$siteId/library')({
  component: LibraryPage,
})

function LibraryPage() {
  const { site, me } = Route.useRouteContext()
  return <LegacyLibrary site={site} me={me} />
}
