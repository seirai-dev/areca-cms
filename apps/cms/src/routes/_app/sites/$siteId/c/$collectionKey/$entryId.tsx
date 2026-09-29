import { createFileRoute } from '@tanstack/react-router'

/**
 * Edit an entry: the editor in focus mode (no sidebar), rendered by the
 * collection layout (see `EditorHost`).
 */
export const Route = createFileRoute(
  '/_app/sites/$siteId/c/$collectionKey/$entryId',
)({
  staticData: { shell: 'focus' },
  component: () => null,
})
