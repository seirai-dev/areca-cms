import { createFileRoute } from '@tanstack/react-router'
import { ArticleCard } from '../../components/article-card.tsx'
import { Eyebrow } from '../../components/ui.tsx'
import { loadJournal, loadTeam } from '../../lib/queries.ts'
import { pageHead } from '../../lib/seo.ts'

export const Route = createFileRoute('/journal/')({
  loader: async () => ({ articles: await loadJournal(), authors: await loadTeam() }),
  head: () =>
    pageHead({
      title: 'Journal',
      description:
        'Brewing notes, origin stories and news from the Northbound roastery, newest first.',
    }),
  component: JournalIndex,
})

function JournalIndex() {
  const { articles, authors } = Route.useLoaderData()
  const [lead, ...rest] = articles
  const authorOf = (article: (typeof articles)[number]) =>
    authors.find((author) => author.id === article.data.author?.id) ?? null

  return (
    <div className="mx-auto max-w-6xl px-5 pb-28 pt-16 sm:px-8 md:pt-24">
      <header className="grid gap-6 md:grid-cols-12 md:items-end">
        <div className="md:col-span-7">
          <Eyebrow>Journal</Eyebrow>
          <h1 className="mt-4 font-display text-5xl leading-[1.02] tracking-tight text-ink md:text-7xl">Journal</h1>
        </div>
        <p className="text-lg leading-8 text-muted md:col-span-4 md:col-start-9">
          Brewing notes, origin stories and news from the roastery.
        </p>
      </header>

      {lead ? (
        <div className="mt-16 border-t border-line pt-16">
          <ArticleCard article={lead} variant="feature" author={authorOf(lead)} />
        </div>
      ) : null}

      {rest.length ? (
        <div className="mt-24 grid gap-x-8 gap-y-16 md:grid-cols-2 lg:grid-cols-6">
          {rest.map((article, index) => {
            const span = cardSpan(index, rest.length)
            return (
              <div key={article.id} className={span.className}>
                <ArticleCard
                  article={article}
                  author={authorOf(article)}
                  variant={span.fullWidth ? 'row' : 'default'}
                />
              </div>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

/**
 * Column spans that leave no empty slots. On lg the grid has 6 tracks: cards
 * take 2 (three per row), a final pair takes 3 each, and a lone last card the
 * full width as a row card. On md (2 columns) a lone last card spans both.
 * Literal class names so Tailwind generates them.
 */
function cardSpan(
  index: number,
  count: number,
): { className: string; fullWidth: boolean } {
  const last = index === count - 1
  const remainder = count % 3
  const lg =
    remainder === 2 && index >= count - 2
      ? 'lg:col-span-3'
      : remainder === 1 && last
        ? 'lg:col-span-6'
        : 'lg:col-span-2'
  const md = count % 2 === 1 && last ? 'md:col-span-2' : ''
  return {
    className: [md, lg].filter(Boolean).join(' '),
    fullWidth: remainder === 1 && last,
  }
}
