import { Link } from '@tanstack/react-router'
import type { Article } from '../lib/content.ts'
import { formatArticleDate } from './article-view.tsx'

export function SiteHeader() {
  return (
    <header className="border-b border-zinc-200 bg-white">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
        <Link to="/" className="text-lg font-semibold tracking-tight text-zinc-950">
          Acme
        </Link>
        <nav className="flex gap-6 text-sm text-zinc-600">
          <Link to="/" className="hover:text-zinc-950">
            Home
          </Link>
          <Link to="/blog" className="hover:text-zinc-950">
            Blog
          </Link>
        </nav>
      </div>
    </header>
  )
}

export function SiteFooter() {
  return (
    <footer className="border-t border-zinc-200">
      <div className="mx-auto max-w-5xl px-4 py-8 text-sm text-zinc-500">
        Copyright Acme. Content from Areca, prerendered at build time.
      </div>
    </footer>
  )
}

export function ArticleCard({ article }: { article: Article }) {
  const published = formatArticleDate(
    article.data.publishedAt ?? article.publishedAt,
  )

  return (
    <article className="rounded-xl border border-zinc-200 bg-white p-6">
      <p className="text-xs uppercase tracking-wide text-zinc-500">
        {[article.data.category, published].filter(Boolean).join(' / ')}
      </p>
      <h2 className="mt-2 text-2xl font-semibold tracking-tight">
        <Link
          to="/blog/$slug"
          params={{ slug: article.slug }}
          className="hover:underline"
        >
          {article.data.title}
        </Link>
      </h2>
      {article.data.excerpt ? (
        <p className="mt-3 text-zinc-600">{article.data.excerpt}</p>
      ) : null}
    </article>
  )
}
