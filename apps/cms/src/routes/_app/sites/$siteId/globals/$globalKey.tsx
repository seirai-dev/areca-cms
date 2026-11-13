import { createFileRoute } from '@tanstack/react-router'
import { localeTagParam, optionalParam, z } from '#/lib/search-params'

import { GlobalEditorScreen } from '#/features/globals/global-editor-screen'

/**
 * Site content section (global): the single-form editor. Any site member can
 * open an enabled section; the screen answers "not found" for disabled ones
 * unless the viewer is an agency admin.
 */
export const Route = createFileRoute('/_app/sites/$siteId/globals/$globalKey')({
  /** Content language shown in the editor, e.g. `?lang=en`. Optional. */
  validateSearch: z.object({
    lang: optionalParam(localeTagParam),
    /** Visual mode (docs/design/visual-editor.md). Below 1280 px it is ignored. */
    view: optionalParam(z.enum(['visual'])),
  }),
  component: GlobalRoute,
})

function GlobalRoute() {
  const { globalKey } = Route.useParams()
  const { me, site } = Route.useRouteContext()
  return <GlobalEditorScreen me={me} site={site} globalKey={globalKey} />
}
