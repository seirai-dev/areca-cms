import { Link } from '@tanstack/react-router'
import type { CoffeesEntry } from '../generated/content/areca.gen.ts'
import { CmsImage } from './cms-image.tsx'
import { formatLabel, formatPrice, splitTastingNotes } from './formatters.ts'
import { RoastScale, TastingChips } from './ui.tsx'

export function CoffeeCard({ coffee }: { coffee: CoffeesEntry }) {
  const { data } = coffee
  const price = formatPrice(data.price)
  const notes = splitTastingNotes(coffee.data.tastingNotes).slice(0, 3)
  const meta = [data.origin, data.region, formatLabel(data.process)].filter(Boolean).join(' · ')

  return (
    <article className="group flex flex-col">
      <div className="relative overflow-hidden rounded-2xl bg-surface">
        {data.image ? (
          <Link
            to="/coffees/$slug"
            params={{ slug: coffee.slug }}
            tabIndex={-1}
            aria-hidden="true"
            className="block"
          >
            <CmsImage
              image={data.image}
              className="aspect-[4/5] w-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.035]"
            />
          </Link>
        ) : (
          <div className="aspect-[4/5] w-full" />
        )}
        {data.limited && data.image ? (
          <span className="absolute left-4 top-4 rounded-full bg-accent-strong px-3 py-1 text-[0.66rem] font-medium uppercase tracking-[0.14em] text-on-accent">
            Limited
          </span>
        ) : null}
      </div>
      <div className="flex flex-1 flex-col pt-5">
        {/* One line only, so long origin/region names do not push titles out of line across the row. */}
        <p className="flex min-w-0 items-center gap-x-2 text-[0.7rem] font-medium uppercase tracking-[0.16em] text-muted">
          <span className="min-w-0 truncate" title={meta}>
            {meta}
          </span>
          {data.limited && !data.image ? (
            <span className="shrink-0 rounded-full bg-accent-strong px-2.5 py-0.5 text-on-accent">Limited</span>
          ) : null}
        </p>
        <h2 className="mt-2 font-display text-2xl leading-tight tracking-tight text-ink">
          <Link
            to="/coffees/$slug"
            params={{ slug: coffee.slug }}
            className="transition-colors hover:text-accent-strong"
          >
            {data.name}
          </Link>
        </h2>
        <TastingChips notes={notes} className="mt-4" />
        <div className="mt-auto flex flex-wrap items-end justify-between gap-x-4 gap-y-2 pt-5">
          <RoastScale level={data.roastLevel} />
          {price ? (
            <p className="whitespace-nowrap text-sm text-ink">
              <span className="font-medium">{price}</span>
              <span className="text-muted"> / 250 g</span>
            </p>
          ) : null}
        </div>
      </div>
    </article>
  )
}
