import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'

import { localeTagSchema } from '#/lib/content-locale'

import { GlobalEditorScreen } from '#/features/globals/global-editor-screen'

/**
 * Site content section (global): the single-form editor. Any site member can
 * open an enabled section; the screen answers "not found" for disabled ones
 * unless the viewer is an agency admin.
 */
export const Route = createFileRoute('/_app/sites/$siteId/globals/$globalKey')({
  /** Content language shown in the editor, e.g. `?lang=en`. Optional. */
  validateSearch: z.object({
    lang: localeTagSchema.optional().catch(undefined),
  }),
  component: GlobalRoute,
})

function GlobalRoute() {
  const { globalKey } = Route.useParams()
  const { me, site } = Route.useRouteContext()
  return <GlobalEditorScreen me={me} site={site} globalKey={globalKey} />
}
