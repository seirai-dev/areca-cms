import { createFileRoute, notFound } from '@tanstack/react-router'
import { ArticleView } from '../../components/article-view.tsx'
import { loadArticle } from '../../lib/queries.ts'

export const Route = createFileRoute('/blog/$slug')({
  loader: async ({ params }) => {
    const article = await loadArticle({ data: { slug: params.slug } })
    if (!article) throw notFound()
    return { article }
  },
  head: ({ loaderData }) => ({
    meta: [
      { title: `${loaderData?.article.data.title ?? 'Article'} - Acme` },
      ...(loaderData?.article.data.excerpt
        ? [{ name: 'description', content: loaderData.article.data.excerpt }]
        : []),
    ],
  }),
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
