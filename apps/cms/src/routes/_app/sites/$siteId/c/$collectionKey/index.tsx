import { createFileRoute } from '@tanstack/react-router'
import { z } from '#/lib/zod'

import { CollectionScreen } from '#/features/collection/collection-screen'

/** `/sites/$siteId/c/$collectionKey`: one collection's entries. */
export const Route = createFileRoute('/_app/sites/$siteId/c/$collectionKey/')({
  validateSearch: z.object({
    /** "Missing translation" filter: a language tag, in `?missing=`. */
    missing: z.string().min(1).max(40).optional().catch(undefined),
  }),
  component: CollectionPage,
})

function CollectionPage() {
  const { collectionKey } = Route.useParams()
  const { me, site } = Route.useRouteContext()
  const { missing } = Route.useSearch()
  const navigate = Route.useNavigate()
  return (
    <CollectionScreen
      me={me}
      site={site}
      collectionKey={collectionKey}
      missingLanguage={missing ?? null}
      onMissingLanguageChange={(next) =>
        void navigate({
          search: (previous) => ({ ...previous, missing: next ?? undefined }),
          replace: true,
        })
      }
    />
  )
}
