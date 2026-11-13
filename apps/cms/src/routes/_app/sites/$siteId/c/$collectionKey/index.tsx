import { createFileRoute } from '@tanstack/react-router'
import { optionalParam, z } from '#/lib/search-params'

import { CollectionScreen } from '#/features/collection/collection-screen'
import {
  collectionEntriesQuery,
  missingLanguageFilter,
} from '#/features/collection/use-collection-entries'
import { prefetchInBrowser } from '#/lib/route-prefetch'

/** `/sites/$siteId/c/$collectionKey`: one collection's entries. */
export const Route = createFileRoute('/_app/sites/$siteId/c/$collectionKey/')({
  validateSearch: z.object({
    /** "Missing translation" filter: a language tag, in `?missing=`. */
    missing: optionalParam(z.string().check(z.minLength(1), z.maxLength(40))),
  }),
  // The first page with the screen's initial filter, started early (see
  // lib/route-prefetch.ts).
  loaderDeps: ({ search }) => ({ missing: search.missing }),
  loader: ({ context, params, deps }) =>
    prefetchInBrowser(() =>
      context.queryClient.prefetchInfiniteQuery(
        collectionEntriesQuery({
          siteId: context.site.id,
          collectionKey: params.collectionKey,
          status: 'all',
          search: '',
          missingLanguage: missingLanguageFilter(
            context.site.languages,
            deps.missing,
          ),
        }),
      ),
    ),
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
