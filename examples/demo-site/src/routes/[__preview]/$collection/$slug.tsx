import { createFileRoute, type ErrorComponentProps } from '@tanstack/react-router'
import { m } from '#/paraglide/messages'
import { useLivePreview } from '@areca-cms/site-sdk/visual-react'
import { z } from 'zod'
import { ArticleView } from '../../../components/article-view.tsx'
import { AuthorView } from '../../../components/author-view.tsx'
import { CoffeeView } from '../../../components/coffee-view.tsx'
import { PageMessage, PreviewBanner } from '../../../components/cms-image.tsx'
import {
  loadLivePreview,
  loadPreview,
  type PreviewPageLoad,
} from '../../../lib/queries.ts'
import { pageHead } from '../../../lib/seo.ts'

const previewSearchSchema = z.object({
  token: z.string().min(1),
})

export const Route = createFileRoute('/__preview/$collection/$slug')({
  validateSearch: (search) => previewSearchSchema.parse(search),
  loaderDeps: ({ search }) => ({ token: search.token }),
  loader: ({ deps }) => loadPreview({ data: { token: deps.token } }),
  head: () => ({
    meta: [
      ...pageHead({ title: 'Preview' }).meta,
      { name: 'robots', content: 'noindex, nofollow' },
    ],
  }),
  component: PreviewPage,
  errorComponent: PreviewError,
})

function PreviewPage() {
  const { collection } = Route.useParams()
  const loaded = Route.useLoaderData()
  // Shows the saved draft until the visual editor sends unsaved values, then those.
  const result = useLivePreview<PreviewPageLoad>({
    initial: loaded,
    cmsOrigin: loaded.cmsOrigin,
    resolve: async (preview) => ({
      ...(await loadLivePreview({ data: preview })),
      cmsOrigin: loaded.cmsOrigin,
    }),
  })

  if (!result.ok) {
    return <PreviewMessage title={m.preview_unavailable()} body={result.error} />
  }

  const draftCollection = result.complete ? result.preview.collection : result.collection
  if (draftCollection !== collection) {
    return (
      <PreviewMessage
        title={m.preview_unavailable()}
        body={m.preview_mismatch({ collection, draft: draftCollection })}
      />
    )
  }

  if (!result.complete) {
    return <PreviewIncomplete issues={result.issues} />
  }

  const { preview } = result
  switch (preview.collection) {
    case 'articles':
      return (
        <ArticleView
          article={preview.entry}
          author={preview.author}
          coffee={preview.coffee}
          preview
        />
      )
    case 'coffees':
      return <CoffeeView coffee={preview.entry} articles={preview.articles} preview />
    case 'authors':
      return <AuthorView author={preview.entry} articles={preview.articles} preview />
  }
}

function PreviewIncomplete({ issues }: { issues: string[] }) {
  return (
    <PageMessage title={m.preview_incomplete_title()}>
      <PreviewBanner />
      <p>{m.preview_incomplete_body()}</p>
      <ul className="mt-4 list-disc space-y-1 pl-5 font-mono text-sm">
        {issues.map((issue) => (
          <li key={issue}>{issue}</li>
        ))}
      </ul>
    </PageMessage>
  )
}

function PreviewError({ error }: ErrorComponentProps) {
  const body = error instanceof Error ? error.message : m.preview_loading_failed()
  return <PreviewMessage title={m.preview_unavailable()} body={body} />
}

function PreviewMessage({ title, body }: { title: string; body: string }) {
  return (
    <PageMessage title={title}>
      <PreviewBanner />
      <p className="text-muted">{body}</p>
    </PageMessage>
  )
}
