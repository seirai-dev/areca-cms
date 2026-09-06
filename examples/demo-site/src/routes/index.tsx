import { Link, createFileRoute } from '@tanstack/react-router'
import { ArticleCard } from '../components/site-chrome.tsx'
import { loadArticles } from '../lib/queries.ts'

export const Route = createFileRoute('/')({
  loader: () => loadArticles(),
  head: () => ({
    meta: [{ title: 'Acme' }],
  }),
  component: Home,
})

function Home() {
  const articles = Route.useLoaderData()
  const latest = articles.slice(0, 3)

  return (
    <div>
      <section className="border-b border-zinc-200 bg-white">
        <div className="mx-auto max-w-5xl px-4 py-20">
          <p className="text-sm font-medium uppercase tracking-wide text-zinc-500">
            Acme
          </p>
          <h1 className="mt-3 max-w-2xl text-5xl font-semibold tracking-tight text-zinc-950">
            Build once. Publish from Areca.
          </h1>
          <p className="mt-5 max-w-xl text-lg text-zinc-600">
            This customer site pulls a pinned content snapshot at build time and
            prerenders every article. Editors stay in the CMS. Visitors never
            call it.
          </p>
          <Link
            to="/blog"
            className="mt-8 inline-flex rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
          >
            Read the blog
          </Link>
        </div>
      </section>
      <section className="mx-auto max-w-5xl px-4 py-16">
        <h2 className="text-2xl font-semibold tracking-tight">Latest articles</h2>
        <div className="mt-6 grid gap-4">
          {latest.map((article) => (
            <ArticleCard key={article.id} article={article} />
          ))}
        </div>
      </section>
    </div>
  )
}
