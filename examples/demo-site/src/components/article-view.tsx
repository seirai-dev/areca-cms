import { richTextHtml } from '@areca/site-sdk'
import type { Article } from '../lib/content.ts'

export function formatArticleDate(value: string | null | undefined): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat('en', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(date)
}

export function ArticleView({
  article,
  preview = false,
}: {
  article: Article
  preview?: boolean
}) {
  const published = formatArticleDate(
    article.data.publishedAt ?? article.publishedAt,
  )
  const html = richTextHtml(article.data.body)

  return (
    <article className="mx-auto max-w-3xl px-4 py-12">
      {preview ? (
        <p className="mb-6 rounded-md border border-amber-300 bg-amber-100 px-4 py-3 text-sm font-semibold tracking-wide text-amber-950">
          PREVIEW - draft content
        </p>
      ) : null}
      {article.data.heroImage ? (
        <img
          src={article.data.heroImage.url}
          alt={article.data.heroImage.alt}
          width={article.data.heroImage.width ?? undefined}
          height={article.data.heroImage.height ?? undefined}
          className="mb-8 aspect-[16/9] w-full rounded-xl object-cover"
        />
      ) : null}
      <p className="text-sm uppercase tracking-wide text-zinc-500">
        {[article.data.category, published].filter(Boolean).join(' / ')}
      </p>
      <h1 className="mt-2 text-4xl font-semibold tracking-tight text-zinc-950">
        {article.data.title}
      </h1>
      {article.data.excerpt ? (
        <p className="mt-4 text-lg text-zinc-600">{article.data.excerpt}</p>
      ) : null}
      <div
        className="prose prose-zinc mt-8 max-w-none"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </article>
  )
}
