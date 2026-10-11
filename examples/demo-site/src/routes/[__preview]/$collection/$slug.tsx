import { createFileRoute, type ErrorComponentProps } from '@tanstack/react-router'
import { z } from 'zod'
import { ArticleView } from '../../../components/article-view.tsx'
import { AuthorView } from '../../../components/author-view.tsx'
import { CoffeeView } from '../../../components/coffee-view.tsx'
import { PageMessage, PreviewBanner } from '../../../components/cms-image.tsx'
import { loadPreview } from '../../../lib/queries.ts'
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
  const result = Route.useLoaderData()

  if (!result.ok) {
    return <PreviewMessage title="Preview unavailable" body={result.error} />
  }

  const { preview } = result
  if (preview.collection !== collection) {
    return (
      <PreviewMessage
        title="Preview unavailable"
        body={`The link points at "${collection}" but the draft is a "${preview.collection}".`}
      />
    )
  }

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

function PreviewError({ error }: ErrorComponentProps) {
  const body = error instanceof Error ? error.message : 'Failed to load preview'
  return <PreviewMessage title="Preview unavailable" body={body} />
}

function PreviewMessage({ title, body }: { title: string; body: string }) {
  return (
    <PageMessage title={title}>
      <PreviewBanner />
      <p className="text-muted">{body}</p>
    </PageMessage>
  )
}
