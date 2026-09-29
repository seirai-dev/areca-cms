import { createFileRoute } from '@tanstack/react-router'

import { LegacyEditor } from '#/features/editor/legacy-editor'

/** New entry: the editor in focus mode (no sidebar). */
export const Route = createFileRoute('/_app/sites/$siteId/c/$collectionKey/new')({
  staticData: { shell: 'focus' },
  component: NewEntryPage,
})

function NewEntryPage() {
  const { collectionKey } = Route.useParams()
  const { me, site } = Route.useRouteContext()
  return <LegacyEditor me={me} site={site} collectionKey={collectionKey} />
}
