import { createFileRoute } from '@tanstack/react-router'
import { localeTagParam, optionalParam, z } from '#/lib/search-params'

/**
 * Edit an entry: the editor in focus mode (no sidebar), rendered by the
 * collection layout (see `EditorHost`).
 */
export const Route = createFileRoute(
  '/_app/sites/$siteId/c/$collectionKey/$entryId',
)({
  /** Content language shown in the editor, e.g. `?lang=en`. Optional. */
  validateSearch: z.object({
    lang: optionalParam(localeTagParam),
    /** Visual mode (docs/design/visual-editor.md). Below 1280 px it is ignored. */
    view: optionalParam(z.enum(['visual'])),
  }),
  staticData: { shell: 'focus' },
  component: () => null,
})
