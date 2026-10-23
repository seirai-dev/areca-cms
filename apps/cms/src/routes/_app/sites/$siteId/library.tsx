import { createFileRoute } from '@tanstack/react-router'
import { z } from '#/lib/zod'

import { resolveLanguage } from '#/features/editor/use-content-language'
import { LibraryScreen } from '#/features/library/library-screen'
import { localeTagSchema } from '#/lib/content-locale'

/**
 * `/sites/$siteId/library`: media shared by the client's sites (brief §3.8).
 * - `?upload=1` opens the file picker (the palette's "Upload" command).
 * - `?alt=missing` lists only images without a description in `?lang=`
 *   (the content language, defaulting to the site's main language). Both
 *   live in the URL so paging and language switches keep the filter.
 */
export const Route = createFileRoute('/_app/sites/$siteId/library')({
  validateSearch: z.object({
    upload: z.coerce.number().optional().catch(undefined),
    alt: z.literal('missing').optional().catch(undefined),
    lang: localeTagSchema.optional().catch(undefined),
  }),
  component: LibraryPage,
})

function LibraryPage() {
  const { site, me } = Route.useRouteContext()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const languages = site.languages
  const altLanguage = languages
    ? resolveLanguage({
        requested: search.lang,
        main: languages.main,
        all: languages.all,
      })
    : null
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
      missingAltOnly={search.alt === 'missing'}
      altLanguage={altLanguage}
      onFilterChange={(next) =>
        void navigate({
          search: (prev) => ({
            ...prev,
            alt: next.missingAltOnly ? 'missing' : undefined,
            lang: next.altLanguage ?? undefined,
          }),
          replace: true,
        })
      }
    />
  )
}
