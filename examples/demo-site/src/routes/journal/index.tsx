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
        <div className="mt-24 grid gap-x-8 gap-y-16 md:grid-cols-2 lg:grid-cols-3">
          {rest.map((article) => (
            <ArticleCard key={article.id} article={article} author={authorOf(article)} />
          ))}
        </div>
      ) : null}
    </div>
  )
}
