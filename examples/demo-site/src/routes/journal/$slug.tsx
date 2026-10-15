import { createFileRoute, notFound } from '@tanstack/react-router'
import { m } from '#/paraglide/messages'
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
      ? entryHead(
          loaderData.article,
          {
            title: loaderData.article.data.title,
            description: loaderData.article.data.excerpt,
            type: 'article',
          },
          loaderData.alternates,
        )
      : pageHead({ title: m.article_not_found() }),
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
    <PageMessage title={m.article_not_found()}>
      {m.article_not_found_body({ slug })}
    </PageMessage>
  )
}
