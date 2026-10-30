import { Link } from '@tanstack/react-router'
import { m } from '#/paraglide/messages'
import type { ArticlesEntry, AuthorsEntry, CoffeesEntry } from '../generated/content/areca.gen.ts'
import { useField } from '../lib/visual-markers.tsx'
import { ArticleBody } from './article-body.tsx'
import { CmsImage, PreviewBanner } from './cms-image.tsx'
import { formatDate, formatPrice, splitTastingNotes } from './formatters.ts'
import { CategoryPill, Eyebrow, JoinedParts, RoastScale } from './ui.tsx'

const ASIDE_HEADING = 'text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-muted'

export function ArticleView({
  article,
  author,
  coffee,
  preview = false,
}: {
  article: ArticlesEntry
  author: AuthorsEntry | null
  coffee: CoffeesEntry | null
  preview?: boolean
}) {
  const { data, seo } = article
  const field = useField()
  const rawDate = data.publishedAt ?? article.publishedAt
  const published = formatDate(rawDate)

  return (
    <article className="pb-28 pt-8 md:pt-14">
      {preview ? (
        <div className="mx-auto max-w-6xl px-5 sm:px-8">
          <PreviewBanner />
        </div>
      ) : null}

      {data.heroImage ? (
        <div className="mx-auto max-w-6xl px-5 sm:px-8">
          <CmsImage
            image={data.heroImage}
            marker={field('heroImage')}
            priority
            className="aspect-[4/3] w-full rounded-3xl object-cover md:aspect-[21/9]"
          />
        </div>
      ) : null}

      <div className="mx-auto max-w-3xl px-5 sm:px-8">
        <header className="pt-12 md:pt-16">
          <div className="flex flex-wrap items-center gap-3 text-sm text-muted">
            <CategoryPill category={data.category} marker={field('category')} />
            {published ? (
              <time dateTime={rawDate ?? undefined} {...field('publishedAt')}>
                {published}
              </time>
            ) : null}
          </div>
          <h1 {...field('title')} className="mt-6 font-display text-5xl leading-[1.04] tracking-tight text-ink md:text-6xl">
            {data.title}
          </h1>
          {data.excerpt ? (
            <p {...field('excerpt')} className="mt-6 font-display text-2xl leading-snug text-muted md:text-[1.7rem]">
              {data.excerpt}
            </p>
          ) : null}
          {author ? (
            <div className="mt-9 flex items-center gap-4 border-t border-line pt-7">
              {author.data.portrait ? (
                <CmsImage
                  image={author.data.portrait}
                  marker={field('portrait', { entry: author.id })}
                  className="size-12 rounded-full object-cover"
                />
              ) : null}
              <p className="text-sm text-muted">
                {m.by()}{' '}
                <Link
                  to="/team/$slug"
                  params={{ slug: author.slug }}
                  {...field('name', { entry: author.id })}
                  className="font-medium text-ink underline decoration-line underline-offset-4 transition-colors hover:decoration-accent-strong hover:text-accent-strong"
                >
                  {author.data.name}
                </Link>
                {author.data.role ? (
                  <span {...field('role', { entry: author.id })} className="block">
                    {author.data.role}
                  </span>
                ) : null}
              </p>
            </div>
          ) : null}
        </header>

        {seo?.summary ? (
          <section aria-label={m.aria_article_summary()} className="mt-12 rounded-2xl bg-surface p-6 ring-1 ring-line md:p-8">
            <h2 className={ASIDE_HEADING}>{m.article_summary()}</h2>
            <p {...field('$seo.summary')} className="mt-3 text-base leading-7 text-ink/90">
              {seo.summary}
            </p>
          </section>
        ) : null}

        {seo?.keyTakeaways.length ? (
          <section aria-label={m.aria_key_takeaways()} className="mt-6 rounded-2xl bg-surface p-6 ring-1 ring-line md:p-8">
            <h2 className={ASIDE_HEADING}>{m.key_takeaways()}</h2>
            <ul {...field('$seo.keyTakeaways')} className="mt-4 space-y-3">
              {seo.keyTakeaways.map((takeaway) => (
                <li key={takeaway} className="flex gap-3 text-base leading-7 text-ink/90">
                  <span aria-hidden="true" className="mt-[0.7rem] size-1.5 shrink-0 rounded-full bg-accent" />
                  <span>{takeaway}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <ArticleBody body={data.body} marker={field('body')} />

        {coffee ? <FeaturedCoffee coffee={coffee} /> : null}

        {seo?.faq.length ? (
          <section className="mt-24" aria-labelledby="faq-heading">
            <h2 id="faq-heading" className="border-b border-line pb-5 font-display text-3xl tracking-tight text-ink md:text-4xl">
              {m.faq_title()}
            </h2>
            <dl {...field('$seo.faq')} className="divide-y divide-line">
              {seo.faq.map((item) => (
                <div key={item.question} className="py-7">
                  <dt className="font-display text-xl leading-snug text-ink">{item.question}</dt>
                  <dd className="mt-3 whitespace-pre-line text-base leading-7 text-muted">{item.answer}</dd>
                </div>
              ))}
            </dl>
          </section>
        ) : null}

        {seo?.about.length ? (
          <footer className="mt-16 border-t border-line pt-8">
            <h2 className={ASIDE_HEADING}>{m.topics()}</h2>
            <ul {...field('$seo.about')} className="mt-4 flex flex-wrap gap-2">
              {seo.about.map((topic) => (
                <li key={topic.name}>
                  {topic.sameAs ? (
                    <a
                      href={topic.sameAs}
                      className="inline-flex rounded-full px-3 py-1 text-sm text-ink ring-1 ring-inset ring-line transition-colors hover:ring-accent-strong hover:text-accent-strong"
                    >
                      {topic.name}
                    </a>
                  ) : (
                    <span className="inline-flex rounded-full px-3 py-1 text-sm text-ink ring-1 ring-inset ring-line">
                      {topic.name}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </footer>
        ) : null}

        {author ? <AuthorBio author={author} /> : null}
      </div>
    </article>
  )
}

/** The featured coffee card. Its fields belong to that coffee entry, not to the article. */
function FeaturedCoffee({ coffee }: { coffee: CoffeesEntry }) {
  const { data } = coffee
  const field = useField()
  const owner = { entry: coffee.id }
  const price = formatPrice(data.price)
  const notes = splitTastingNotes(coffee.data.tastingNotes).slice(0, 3)
  return (
    <section className="mt-24" aria-labelledby="featured-coffee">
      <h2 id="featured-coffee" className={ASIDE_HEADING}>
        {m.featured_coffee()}
      </h2>
      <Link
        to="/coffees/$slug"
        params={{ slug: coffee.slug }}
        className="group mt-5 grid gap-6 rounded-3xl bg-surface p-5 ring-1 ring-line transition-shadow duration-300 hover:shadow-card sm:grid-cols-[9rem_1fr] sm:p-6"
      >
        {data.image ? (
          <CmsImage
            image={data.image}
            marker={field('image', owner)}
            className="aspect-square w-full rounded-2xl object-cover sm:w-36"
          />
        ) : null}
        <div className="flex flex-col justify-center">
          <Eyebrow>
            <JoinedParts
              parts={[
                { value: data.origin, marker: field('origin', owner) },
                { value: data.region, marker: field('region', owner) },
              ]}
            />
          </Eyebrow>
          <p
            {...field('name', owner)}
            className="mt-2 font-display text-3xl leading-tight text-ink transition-colors group-hover:text-accent-strong"
          >
            {data.name}
          </p>
          {notes.length ? (
            <p {...field('tastingNotes', owner)} className="mt-2 text-sm text-muted">
              {notes.join(', ')}
            </p>
          ) : null}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm">
            <RoastScale level={data.roastLevel} marker={field('roastLevel', owner)} />
            {price ? (
              <span {...field('price', owner)} className="font-medium text-ink">
                {price} {m.price_per_250g()}
              </span>
            ) : null}
          </div>
        </div>
      </Link>
    </section>
  )
}

/** The article's author at the foot of the page. Its fields belong to the author entry. */
function AuthorBio({ author }: { author: AuthorsEntry }) {
  const { data } = author
  const field = useField()
  const owner = { entry: author.id }
  return (
    <section aria-label={m.aria_about_author()} className="mt-24 flex flex-col gap-6 rounded-3xl bg-brand p-8 text-brand-ink sm:flex-row sm:items-center md:p-10">
      {data.portrait ? (
        <CmsImage
          image={data.portrait}
          marker={field('portrait', owner)}
          className="size-24 shrink-0 rounded-2xl object-cover"
        />
      ) : null}
      <div>
        <p className="text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-brand-ink/70">{m.written_by()}</p>
        <p className="mt-2 font-display text-2xl">
          <span {...field('name', owner)}>{data.name}</span>
          {data.role ? (
            <span className="text-brand-ink/70">
              {' '}
              · <span {...field('role', owner)}>{data.role}</span>
            </span>
          ) : null}
        </p>
        {data.bio ? (
          <p {...field('bio', owner)} className="mt-3 leading-7 text-brand-ink/85">
            {data.bio}
          </p>
        ) : null}
        <Link
          to="/team/$slug"
          params={{ slug: author.slug }}
          className="mt-5 inline-block text-sm font-medium underline decoration-brand-ink/40 underline-offset-4 transition-colors hover:decoration-brand-ink"
        >
          {m.more_from({ name: data.name })}
        </Link>
      </div>
    </section>
  )
}
