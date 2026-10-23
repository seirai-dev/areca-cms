import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'

import { LibraryScreen } from '#/features/library/library-screen'

/**
 * `/sites/$siteId/library`: media shared by the client's sites (brief §3.8).
 * `?upload=1` opens the file picker (the palette's "Upload" command).
 */
export const Route = createFileRoute('/_app/sites/$siteId/library')({
  validateSearch: z.object({
    upload: z.coerce.number().optional().catch(undefined),
  }),
  component: LibraryPage,
})

function LibraryPage() {
  const { site, me } = Route.useRouteContext()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  return (
    <LibraryScreen
      site={site}
      me={me}
      uploadRequested={search.upload === 1}
      onUploadRequestHandled={() =>
        void navigate({
          search: (prev) => ({ ...prev, upload: undefined }),
          replace: true,
        })
      }
    />
  )
}
