import { createFileRoute } from '@tanstack/react-router'
import { localeTagParam, optionalParam, z } from '#/lib/search-params'

import {
  aiAvailabilityQuery,
  entryQuery,
  previewUrlQuery,
} from '#/lib/content/queries'
import { prefetchInBrowser } from '#/lib/route-prefetch'

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
  // The entry starts loading next to the collections (site layout) and the
  // editor's code, instead of after them; its preview URL follows the entry.
  // Hovering a link loads the entry only (see lib/route-prefetch.ts).
  loader: ({ context, params, preload }) => {
    const { queryClient, site } = context
    const entry = entryQuery(params.entryId)
    prefetchInBrowser(async () => {
      await queryClient.prefetchQuery(entry)
      if (preload) return
      const slug = queryClient.getQueryData(entry.queryKey)?.slug
      if (slug)
        await queryClient.prefetchQuery(
          previewUrlQuery(site.id, params.collectionKey, slug),
        )
    })
    if (!preload)
      prefetchInBrowser(() => queryClient.prefetchQuery(aiAvailabilityQuery()))
  },
  component: () => null,
})
