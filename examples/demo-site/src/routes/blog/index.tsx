import { createFileRoute } from '@tanstack/react-router'
import { ArticleCard } from '../../components/site-chrome.tsx'
import { loadArticles } from '../../lib/queries.ts'

export const Route = createFileRoute('/blog/')({
  loader: () => loadArticles(),
  head: () => ({
    meta: [{ title: 'Blog - Acme' }],
  }),
  component: BlogIndex,
})

function BlogIndex() {
  const articles = Route.useLoaderData()

  return (
    <div className="mx-auto max-w-5xl px-4 py-16">
      <h1 className="text-4xl font-semibold tracking-tight">Blog</h1>
      <p className="mt-3 text-zinc-600">News and product updates from Acme.</p>
      <div className="mt-10 grid gap-4">
        {articles.map((article) => (
          <ArticleCard key={article.id} article={article} />
        ))}
      </div>
    </div>
  )
}
