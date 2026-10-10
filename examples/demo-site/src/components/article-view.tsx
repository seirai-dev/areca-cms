import type { Article } from '../lib/content.ts'
import { ArticleBody } from './article-body.tsx'

export function formatArticleDate(
  value: string | null | undefined,
): string | null {
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
      {article.seo?.author ? (
        <div className="mt-4 text-sm text-zinc-600">
          <p>
            By{' '}
            {article.seo.author.url ? (
              <a href={article.seo.author.url} className="underline">
                {article.seo.author.name}
              </a>
            ) : (
              article.seo.author.name
            )}
          </p>
          {article.seo.author.bio ? (
            <p className="mt-2">{article.seo.author.bio}</p>
          ) : null}
        </div>
      ) : null}
      {article.seo?.summary ? (
        <section
          className="mt-8 rounded-xl bg-zinc-100 p-5"
          aria-label="Article summary"
        >
          <h2 className="text-lg font-semibold">Summary</h2>
          <p className="mt-2 leading-7 text-zinc-700">{article.seo.summary}</p>
        </section>
      ) : null}
      {article.seo?.keyTakeaways.length ? (
        <section className="mt-8" aria-label="Key takeaways">
          <h2 className="text-xl font-semibold">Key takeaways</h2>
          <ul className="mt-3 list-disc space-y-2 pl-6 text-zinc-700">
            {article.seo.keyTakeaways.map((takeaway, index) => (
              <li key={index}>{takeaway}</li>
            ))}
          </ul>
        </section>
      ) : null}
      <ArticleBody body={article.data.body} />
      {article.seo?.faq.length ? (
        <section className="mt-12" aria-label="Frequently asked questions">
          <h2 className="text-2xl font-semibold">Frequently asked questions</h2>
          <dl className="mt-5 space-y-6">
            {article.seo.faq.map((item, index) => (
              <div key={index}>
                <dt className="font-semibold">{item.question}</dt>
                <dd className="mt-2 whitespace-pre-line leading-7 text-zinc-700">
                  {item.answer}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}
      {article.seo?.about.length ? (
        <footer className="mt-10 border-t border-zinc-200 pt-5 text-sm text-zinc-600">
          <p className="font-semibold">Topics</p>
          <ul className="mt-2 flex flex-wrap gap-3">
            {article.seo.about.map((topic, index) => (
              <li key={index}>
                {topic.sameAs ? (
                  <a href={topic.sameAs} className="underline">
                    {topic.name}
                  </a>
                ) : (
                  topic.name
                )}
              </li>
            ))}
          </ul>
        </footer>
      ) : null}
    </article>
  )
}
