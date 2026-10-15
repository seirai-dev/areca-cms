import { Link } from '@tanstack/react-router'
import { m } from '#/paraglide/messages'
import type { ArticlesEntry, AuthorsEntry } from '../generated/content/areca.gen.ts'
import { ArticleCard } from './article-card.tsx'
import { CmsImage, PreviewBanner } from './cms-image.tsx'
import { Eyebrow, SectionHeading } from './ui.tsx'

export function AuthorView({
  author,
  articles,
  preview = false,
}: {
  author: AuthorsEntry
  articles: ArticlesEntry[]
  preview?: boolean
}) {
  const { data } = author
  return (
    <div className="mx-auto max-w-6xl px-5 pb-28 pt-8 sm:px-8 md:pt-14">
      {preview ? <PreviewBanner /> : null}
      <Link to="/team" className="text-sm text-muted transition-colors hover:text-ink">
        {m.back_to_team()}
      </Link>
      <div className="mt-8 grid gap-12 md:mt-10 md:grid-cols-12 md:items-end md:gap-16">
        {data.portrait ? (
          <div className="md:col-span-5">
            <CmsImage
              image={data.portrait}
              priority
              className="aspect-[4/5] w-full rounded-3xl object-cover"
            />
          </div>
        ) : null}
        <div className={data.portrait ? 'md:col-span-6 md:col-start-7' : 'md:col-span-12'}>
          <Eyebrow>{data.role ?? m.eyebrow_team()}</Eyebrow>
          <h1 className="mt-4 font-display text-5xl leading-[1.02] tracking-tight text-ink md:text-7xl">
            {data.name}
          </h1>
          {data.bio ? (
            <p className="mt-8 font-display text-2xl leading-snug text-ink/90 md:text-3xl">{data.bio}</p>
          ) : null}
        </div>
      </div>

      {articles.length ? (
        <section className="mt-28 border-t border-line pt-16" aria-labelledby="author-articles">
          <SectionHeading
            id="author-articles"
            eyebrow={m.eyebrow_journal()}
            title={m.writing_by({ name: data.name })}
          />
          <div className="mt-10 grid gap-x-8 gap-y-14 md:grid-cols-2">
            {articles.map((article) => (
              <ArticleCard key={article.id} article={article} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  )
}
