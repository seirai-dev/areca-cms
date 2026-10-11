import { createFileRoute, notFound } from '@tanstack/react-router'
import { ArticleView } from '../../components/article-view.tsx'
import { PageMessage } from '../../components/cms-image.tsx'
import { loadArticle } from '../../lib/queries.ts'
import { entryHead, pageHead } from '../../lib/seo.ts'

export const Route = createFileRoute('/journal/$slug')({
  loader: async ({ params }) => {
    const data = await loadArticle({ data: { slug: params.slug } })
    if (!data) throw notFound()
    return data
  },
  head: ({ loaderData }) =>
    loaderData
      ? entryHead(loaderData.article, {
          title: loaderData.article.data.title,
          description: loaderData.article.data.excerpt,
          type: 'article',
        })
      : pageHead({ title: 'Article not found' }),
  component: JournalArticle,
  notFoundComponent: JournalArticleMissing,
})

function JournalArticle() {
  const { article, author, coffee } = Route.useLoaderData()
  return <ArticleView article={article} author={author} coffee={coffee} />
}

function JournalArticleMissing() {
  const { slug } = Route.useParams()
  return (
    <PageMessage title="Article not found">
      No published article with slug “{slug}”.
    </PageMessage>
  )
}
