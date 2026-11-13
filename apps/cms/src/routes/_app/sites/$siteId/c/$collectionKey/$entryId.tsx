import { createFileRoute } from '@tanstack/react-router'
import { z } from '#/lib/zod'

import { localeTagSchema } from '#/lib/content-locale'
import {
  aiAvailabilityQuery,
  entryQuery,
  previewUrlQuery,
} from '#/lib/content/queries'

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
    /** Visual mode (docs/design/visual-editor.md). Below 1280 px it is ignored. */
    view: z.enum(['visual']).optional().catch(undefined),
  }),
  staticData: { shell: 'focus' },
  // The entry starts loading next to the collections (site layout) and the
  // editor's code, instead of after them; its preview URL follows the entry.
  // Hovering a link loads the entry only. Not awaited: the editor keeps its
  // own loading and error states.
  loader: ({ context, params, preload }) => {
    const { queryClient, site } = context
    const entry = queryClient.prefetchQuery(entryQuery(params.entryId))
    if (preload) return
    void queryClient.prefetchQuery(aiAvailabilityQuery())
    void entry.then(() => {
      const slug = queryClient.getQueryData(
        entryQuery(params.entryId).queryKey,
      )?.slug
      if (slug)
        void queryClient.prefetchQuery(
          previewUrlQuery(site.id, params.collectionKey, slug),
        )
    })
  },
  component: () => null,
})
