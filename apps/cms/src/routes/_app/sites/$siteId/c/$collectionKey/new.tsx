import { createFileRoute } from '@tanstack/react-router'
import { z } from '#/lib/zod'

import { localeTagSchema } from '#/lib/content-locale'

/**
 * New entry: the editor in focus mode (no sidebar). The editor itself is
 * rendered by the collection layout (see `EditorHost`) so it survives the
 * switch to `/$entryId` after the first autosave.
 */
export const Route = createFileRoute(
  '/_app/sites/$siteId/c/$collectionKey/new',
)({
  /** Content language shown in the editor, e.g. `?lang=en`. Optional. */
  validateSearch: z.object({
    lang: localeTagSchema.optional().catch(undefined),
  }),
  staticData: { shell: 'focus' },
  component: () => null,
})
