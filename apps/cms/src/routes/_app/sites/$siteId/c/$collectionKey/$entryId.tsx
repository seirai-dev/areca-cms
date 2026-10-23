import { createFileRoute } from '@tanstack/react-router'
import { z } from '#/lib/zod'

import { localeTagSchema } from '#/lib/content-locale'

/**
 * Edit an entry: the editor in focus mode (no sidebar), rendered by the
 * collection layout (see `EditorHost`).
 */
export const Route = createFileRoute(
  '/_app/sites/$siteId/c/$collectionKey/$entryId',
)({
  /** Content language shown in the editor, e.g. `?lang=en`. Optional. */
  validateSearch: z.object({
    lang: localeTagSchema.optional().catch(undefined),
  }),
  staticData: { shell: 'focus' },
  component: () => null,
})
