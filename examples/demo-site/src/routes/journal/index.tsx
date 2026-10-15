import { createFileRoute } from '@tanstack/react-router'
import { m } from '#/paraglide/messages'
import { ArticleCard } from '../../components/article-card.tsx'
import { Eyebrow } from '../../components/ui.tsx'
import { pageAlternates } from '../../lib/i18n.ts'
import { loadJournal } from '../../lib/queries.ts'
import { pageHead } from '../../lib/seo.ts'

export const Route = createFileRoute('/journal/')({
  loader: async () => ({ articles: await loadJournal() }),
  head: () => pageHead({ title: m.journal_title(), description: m.meta_journal_description() }, pageAlternates('/journal')),
  component: JournalIndex,
})

function JournalIndex() {
  const { articles } = Route.useLoaderData()
  const [lead, ...rest] = articles

  return (
    <div className="mx-auto max-w-6xl px-5 pb-28 pt-16 sm:px-8 md:pt-24">
      <header className="grid gap-6 md:grid-cols-12 md:items-end">
        <div className="md:col-span-7">
          <Eyebrow>{m.eyebrow_journal()}</Eyebrow>
          <h1 className="mt-4 font-display text-5xl leading-[1.02] tracking-tight text-ink md:text-7xl">{m.journal_title()}</h1>
        </div>
        <p className="text-lg leading-8 text-muted md:col-span-4 md:col-start-9">
          {m.journal_intro()}
        </p>
      </header>

      {lead ? (
        <div className="mt-16 border-t border-line pt-16">
          <ArticleCard article={lead} variant="feature" author={lead.data.author} />
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
                  author={article.data.author}
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
