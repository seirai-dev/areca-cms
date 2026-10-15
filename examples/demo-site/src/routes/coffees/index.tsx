import { createFileRoute } from '@tanstack/react-router'
import { m } from '#/paraglide/messages'
import { CoffeeCard } from '../../components/coffee-card.tsx'
import { Eyebrow } from '../../components/ui.tsx'
import { pageAlternates } from '../../lib/i18n.ts'
import { loadCoffees } from '../../lib/queries.ts'
import { pageHead } from '../../lib/seo.ts'

export const Route = createFileRoute('/coffees/')({
  loader: () => loadCoffees(),
  head: () =>
    pageHead(
      { title: m.coffees_title(), description: m.meta_coffees_description() },
      pageAlternates('/coffees'),
    ),
  component: CoffeesIndex,
})

function CoffeesIndex() {
  const coffees = Route.useLoaderData()

  return (
    <div className="mx-auto max-w-6xl px-5 pb-28 pt-16 sm:px-8 md:pt-24">
      <header className="grid gap-6 md:grid-cols-12 md:items-end">
        <div className="md:col-span-7">
          <Eyebrow>{m.eyebrow_shop()}</Eyebrow>
          <h1 className="mt-4 font-display text-5xl leading-[1.02] tracking-tight text-ink md:text-7xl">{m.coffees_title()}</h1>
        </div>
        <p className="text-lg leading-8 text-muted md:col-span-4 md:col-start-9">
          {m.coffees_intro()}
        </p>
      </header>
      <div className="mt-16 grid gap-x-8 gap-y-16 border-t border-line pt-16 md:grid-cols-2 lg:grid-cols-3">
        {coffees.map((coffee) => (
          <CoffeeCard key={coffee.id} coffee={coffee} />
        ))}
      </div>
    </div>
  )
}
