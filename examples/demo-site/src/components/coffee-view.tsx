import { Link } from '@tanstack/react-router'
import type { Article, Coffee } from '../lib/content.ts'
import { ArticleBody } from './article-body.tsx'
import { ArticleCard } from './article-card.tsx'
import { CmsImage, PreviewBanner } from './cms-image.tsx'
import { CoffeeSpecs } from './coffee-specs.tsx'
import { formatLabel, formatPrice, splitTastingNotes } from './formatters.ts'
import { buttonPrimary, Eyebrow, RoastScale, SectionHeading, TastingChips } from './ui.tsx'

export function CoffeeView({
  coffee,
  articles,
  preview = false,
}: {
  coffee: Coffee
  articles: Article[]
  preview?: boolean
}) {
  const { data } = coffee
  const notes = splitTastingNotes(coffee.data.tastingNotes)
  const price = formatPrice(data.price)
  const origin = [data.origin, data.region].filter(Boolean).join(' · ')
  const process = formatLabel(data.process)

  return (
    <div className="mx-auto max-w-6xl px-5 pb-28 pt-8 sm:px-8 md:pt-14">
      {preview ? <PreviewBanner /> : null}
      <Link to="/coffees" className="text-sm text-muted transition-colors hover:text-ink">
        ← All coffees
      </Link>

      <div className="mt-8 grid gap-12 md:mt-10 md:grid-cols-12 md:gap-16">
        <div className="md:col-span-7">
          {data.image ? (
            <div className="overflow-hidden rounded-3xl bg-surface">
              <CmsImage image={data.image} priority className="aspect-[4/5] w-full object-cover" />
            </div>
          ) : null}
        </div>

        <div className="md:col-span-5">
          <div className="md:sticky md:top-28">
            <Eyebrow>{[origin, process].filter(Boolean).join(' · ')}</Eyebrow>
            {data.limited ? (
              <span className="mt-4 inline-flex rounded-full bg-accent-strong px-3 py-1 text-[0.66rem] font-medium uppercase tracking-[0.14em] text-on-accent">
                Limited release
              </span>
            ) : null}
            <h1 className="mt-4 font-display text-5xl leading-[1.02] tracking-tight text-ink md:text-6xl">
              {data.name}
            </h1>

            <div className="mt-7 flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
              {price ? (
                <p className="text-ink">
                  <span className="font-display text-4xl">{price}</span>
                  <span className="text-sm text-muted"> / 250 g</span>
                </p>
              ) : null}
              <RoastScale level={data.roastLevel} />
            </div>

            {notes.length ? (
              <div className="mt-8">
                <Eyebrow>Tasting notes</Eyebrow>
                <TastingChips notes={notes} className="mt-3" />
              </div>
            ) : null}

            <div className="mt-8">
              <CoffeeSpecs coffee={coffee} />
            </div>

            {data.shopUrl ? (
              <a
                href={data.shopUrl}
                rel="noopener noreferrer"
                target="_blank"
                className={`${buttonPrimary} mt-9 w-full sm:w-auto`}
              >
                Buy on the shop
                <span aria-hidden="true">↗</span>
                <span className="sr-only">(opens in a new tab)</span>
              </a>
            ) : null}
          </div>
        </div>
      </div>

      {data.description ? (
        <div className="max-w-3xl md:pr-16">
          <ArticleBody body={data.description} />
        </div>
      ) : null}

      {articles.length ? (
        <section className="mt-28 border-t border-line pt-16" aria-labelledby="related-journal">
          <SectionHeading id="related-journal" eyebrow="Journal" title="Read about this coffee" />
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
