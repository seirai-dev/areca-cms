import { createFileRoute } from '@tanstack/react-router'
import { optionalParam, z } from '#/lib/search-params'

import { CollectionScreen } from '#/features/collection/collection-screen'

/** `/sites/$siteId/c/$collectionKey`: one collection's entries. */
export const Route = createFileRoute('/_app/sites/$siteId/c/$collectionKey/')({
  validateSearch: z.object({
    /** "Missing translation" filter: a language tag, in `?missing=`. */
    missing: optionalParam(z.string().check(z.minLength(1), z.maxLength(40))),
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
