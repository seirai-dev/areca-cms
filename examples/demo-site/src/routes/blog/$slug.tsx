import { createFileRoute, notFound } from '@tanstack/react-router'
import { ArticleView } from '../../components/article-view.tsx'
import { loadArticle } from '../../lib/queries.ts'
import { articleHead } from '../../lib/seo.ts'

export const Route = createFileRoute('/blog/$slug')({
  loader: async ({ params }) => {
    const article = await loadArticle({ data: { slug: params.slug } })
    if (!article) throw notFound()
    return { article }
  },
  head: ({ loaderData }) => articleHead(loaderData?.article),
  component: BlogArticle,
  notFoundComponent: ArticleMissing,
})

function BlogArticle() {
  const { article } = Route.useLoaderData()
  return <ArticleView article={article} />
}

function ArticleMissing() {
  const { slug } = Route.useParams()
  return (
    <div className="mx-auto max-w-3xl px-4 py-16">
      <h1 className="text-3xl font-semibold">Article not found</h1>
      <p className="mt-3 text-zinc-600">
        No published article with slug “{slug}”.
      </p>
    </div>
  )
}
