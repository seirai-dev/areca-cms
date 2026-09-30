import { createFileRoute } from '@tanstack/react-router'

/**
 * New entry: the editor in focus mode (no sidebar). The editor itself is
 * rendered by the collection layout (see `EditorHost`) so it survives the
 * switch to `/$entryId` after the first autosave.
 */
export const Route = createFileRoute(
  '/_app/sites/$siteId/c/$collectionKey/new',
)({
  staticData: { shell: 'focus' },
  component: () => null,
})
