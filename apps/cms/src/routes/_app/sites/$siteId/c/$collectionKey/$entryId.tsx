import { createFileRoute } from '@tanstack/react-router'

import { LegacyEditor } from '#/features/editor/legacy-editor'

/** Edit an entry: the editor in focus mode (no sidebar). */
export const Route = createFileRoute(
  '/_app/sites/$siteId/c/$collectionKey/$entryId',
)({
  staticData: { shell: 'focus' },
  component: EditEntryPage,
})

function EditEntryPage() {
  const { collectionKey, entryId } = Route.useParams()
  const { me, site } = Route.useRouteContext()
  return (
    <LegacyEditor
      me={me}
      site={site}
      collectionKey={collectionKey}
      entryId={entryId}
    />
  )
}
