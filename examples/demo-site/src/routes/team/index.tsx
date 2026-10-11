import { createFileRoute } from '@tanstack/react-router'
import { AuthorCard } from '../../components/author-card.tsx'
import { Eyebrow } from '../../components/ui.tsx'
import { loadTeam } from '../../lib/queries.ts'
import { pageHead } from '../../lib/seo.ts'

export const Route = createFileRoute('/team/')({
  loader: () => loadTeam(),
  head: () =>
    pageHead({
      title: 'Team',
      description: 'The people who buy, roast and write for Northbound Coffee Co.',
    }),
  component: TeamIndex,
})

function TeamIndex() {
  const authors = Route.useLoaderData()

  return (
    <div className="mx-auto max-w-6xl px-5 pb-28 pt-16 sm:px-8 md:pt-24">
      <header className="grid gap-6 md:grid-cols-12 md:items-end">
        <div className="md:col-span-7">
          <Eyebrow>Team</Eyebrow>
          <h1 className="mt-4 font-display text-5xl leading-[1.02] tracking-tight text-ink md:text-7xl">Team</h1>
        </div>
        <p className="text-lg leading-8 text-muted md:col-span-4 md:col-start-9">
          The people who buy the coffee, roast it and write about it.
        </p>
      </header>
      <div className="mt-16 grid gap-x-8 gap-y-20 border-t border-line pt-16 md:grid-cols-3">
        {authors.map((author) => (
          <AuthorCard key={author.id} author={author} />
        ))}
      </div>
    </div>
  )
}
