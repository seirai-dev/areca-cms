import { Link } from '@tanstack/react-router'
import type { Article, Author } from '../lib/content.ts'
import { CmsImage } from './cms-image.tsx'
import { formatDate } from './formatters.ts'
import { CategoryPill } from './ui.tsx'

/**
 * `feature` is the large side-by-side lead story, `lead` a large stacked one
 * for narrower columns, `row` a compact side-by-side card, and `default` a
 * vertical card. `author` adds a byline with a round portrait.
 */
export function ArticleCard({
  article,
  author = null,
  variant = 'default',
}: {
  article: Article
  author?: Author | null
  variant?: 'default' | 'feature' | 'lead' | 'row'
}) {
  const { data } = article
  const rawDate = data.publishedAt ?? article.publishedAt
  const published = formatDate(rawDate)
  const isFeature = variant === 'feature'
  const isRow = variant === 'row'
  const isLead = variant === 'lead'

  const image = data.heroImage ? (
    <Link
      to="/journal/$slug"
      params={{ slug: article.slug }}
      tabIndex={-1}
      aria-hidden="true"
      className={`block shrink-0 overflow-hidden rounded-2xl bg-surface ${isRow ? 'w-32 sm:w-40' : ''}`}
    >
      <CmsImage
        image={data.heroImage}
        className={`group-hover:scale-[1.035] h-full w-full object-cover transition-transform duration-700 ease-out ${
          isFeature
            ? 'aspect-[4/3] md:aspect-[5/4]'
            : isRow
              ? 'aspect-square'
              : isLead
                ? 'aspect-[16/10]'
                : 'aspect-[3/2]'
        }`}
      />
    </Link>
  ) : null

  const title = (
    <h2
      className={`font-display leading-[1.1] tracking-tight text-ink ${
        isFeature
          ? 'mt-6 text-4xl md:text-5xl'
          : isLead
            ? 'mt-5 text-3xl md:text-4xl'
            : isRow
              ? 'mt-3 text-xl'
              : 'mt-5 text-2xl'
      }`}
    >
      <Link
        to="/journal/$slug"
        params={{ slug: article.slug }}
        className="transition-colors hover:text-accent-strong"
      >
        {data.title}
      </Link>
    </h2>
  )

  const byline = author ? (
    <p className="mt-5 flex items-center gap-3 text-sm text-muted">
      {author.data.portrait ? (
        <CmsImage image={author.data.portrait} className="size-8 rounded-full object-cover" />
      ) : null}
      <span>
        By <span className="font-medium text-ink">{author.data.name}</span>
      </span>
    </p>
  ) : null

  const meta = (
    <div className="flex flex-wrap items-center gap-3 text-sm text-muted">
      <CategoryPill category={data.category} />
      {published ? (
        <time dateTime={rawDate ?? undefined}>{published}</time>
      ) : null}
    </div>
  )

  const excerpt = data.excerpt ? (
    <p
      className={`text-muted ${
        isFeature || isLead ? 'mt-5 text-lg leading-8' : isRow ? 'mt-2 line-clamp-2 text-sm leading-6' : 'mt-3 line-clamp-3 leading-7'
      }`}
    >
      {data.excerpt}
    </p>
  ) : null

  if (isRow) {
    return (
      <article className="group flex gap-5">
        {image}
        <div className="min-w-0 flex-1">
          {meta}
          {title}
          {excerpt}
        </div>
      </article>
    )
  }

  if (isFeature) {
    return (
      <article className="group grid gap-8 md:grid-cols-[1.15fr_1fr] md:items-center md:gap-12">
        {image}
        <div>
          {meta}
          {title}
          {excerpt}
          {byline}
          <p className="mt-6">
            <Link
              to="/journal/$slug"
              params={{ slug: article.slug }}
              className="text-sm font-medium text-ink underline decoration-line underline-offset-[6px] transition-colors hover:text-accent-strong hover:decoration-accent-strong"
            >
              Read the story
            </Link>
          </p>
        </div>
      </article>
    )
  }

  return (
    <article className="group flex flex-col">
      {image}
      <div className="flex flex-1 flex-col">
        <div className="mt-5">{meta}</div>
        {title}
        {excerpt}
        {byline}
      </div>
    </article>
  )
}
