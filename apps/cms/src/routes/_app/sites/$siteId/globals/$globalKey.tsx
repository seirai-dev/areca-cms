import { createFileRoute } from '@tanstack/react-router'
import { z } from '#/lib/zod'

import { localeTagSchema } from '#/lib/content-locale'

import {
  GlobalEditorScreen,
  globalQuery,
} from '#/features/globals/global-editor-screen'
import { aiAvailabilityQuery } from '#/lib/content/queries'

/**
 * Site content section (global): the single-form editor. Any site member can
 * open an enabled section; the screen answers "not found" for disabled ones
 * unless the viewer is an agency admin.
 */
export const Route = createFileRoute('/_app/sites/$siteId/globals/$globalKey')({
  /** Content language shown in the editor, e.g. `?lang=en`. Optional. */
  validateSearch: z.object({
    lang: localeTagSchema.optional().catch(undefined),
    /** Visual mode (docs/design/visual-editor.md). Below 1280 px it is ignored. */
    view: z.enum(['visual']).optional().catch(undefined),
  }),
  // Started early, not awaited (see the site layout's loader).
  loader: ({ context, params, preload }) => {
    const { queryClient, site } = context
    void queryClient.prefetchQuery(globalQuery(site.id, params.globalKey))
    if (!preload) void queryClient.prefetchQuery(aiAvailabilityQuery())
  },
  component: GlobalRoute,
})

function GlobalRoute() {
  const { globalKey } = Route.useParams()
  const { me, site } = Route.useRouteContext()
  return <GlobalEditorScreen me={me} site={site} globalKey={globalKey} />
}
