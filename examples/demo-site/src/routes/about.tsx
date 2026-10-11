import { Link, createFileRoute } from '@tanstack/react-router'
import { CmsImage } from '../components/cms-image.tsx'
import { Eyebrow } from '../components/ui.tsx'
import { loadHome } from '../lib/queries.ts'
import { pageHead } from '../lib/seo.ts'

export const Route = createFileRoute('/about')({
  loader: () => loadHome(),
  head: () =>
    pageHead({
      title: 'About',
      description:
        'Northbound Coffee Co. is a small roastery in Bergen, Norway, founded in 2016. We buy direct and roast in small batches.',
    }),
  component: About,
})

function About() {
  const { articles, coffees } = Route.useLoaderData()
  const image = articles[1]?.data.heroImage ?? articles[0]?.data.heroImage ?? coffees[0]?.data.image ?? null

  return (
    <article className="mx-auto max-w-6xl px-5 pb-28 pt-16 sm:px-8 md:pt-24">
      <header className="max-w-4xl">
        <Eyebrow>About</Eyebrow>
        <h1 className="mt-5 font-display text-5xl leading-[1.02] tracking-tight text-ink md:text-7xl">
          A small roastery on the Bergen harbour.
        </h1>
      </header>

      <div className="mt-16 grid gap-12 md:grid-cols-12 md:gap-16">
        {image ? (
          <figure className="md:col-span-5 md:sticky md:top-28 md:self-start">
            <div className="overflow-hidden rounded-3xl bg-surface">
              <CmsImage image={image} className="aspect-[4/5] w-full object-cover" />
            </div>
          </figure>
        ) : null}

        <div className={`${image ? 'md:col-span-6 md:col-start-7' : 'md:col-span-8'} space-y-7 text-lg leading-[1.8] text-ink/90`}>
          <p className="font-display text-2xl leading-snug text-ink md:text-3xl">
            Northbound Coffee Co. started in 2016 with one secondhand roaster and a notebook of cupping scores.
          </p>
          <p>
            We are still a small team in Bergen, Norway, and we still roast every batch ourselves.
          </p>
          <blockquote className="border-l-2 border-accent py-1 pl-7 font-display text-2xl italic leading-snug text-ink md:text-3xl">
            We set aside any batch that is not ready.
          </blockquote>
          <p>
            We roast on a 15 kg Giesen in batches small enough to watch closely. That lets us profile each lot by
            hand, slow the roast when a coffee needs time, and set aside any batch that is not ready. Roasted coffee
            is sold within a few weeks, with the roast date on the bag.
          </p>
          <p>
            We buy direct. Our buyer agrees prices with producers before harvest, cups samples at origin and shares
            roasting feedback both ways. Read more about the farms in the{' '}
            <Link to="/journal" className="font-medium text-ink underline decoration-accent/60 underline-offset-[5px] transition-colors hover:text-accent-strong hover:decoration-accent-strong">
              journal
            </Link>
            , or meet the{' '}
            <Link to="/team" className="font-medium text-ink underline decoration-accent/60 underline-offset-[5px] transition-colors hover:text-accent-strong hover:decoration-accent-strong">
              people
            </Link>{' '}
            behind each lot.
          </p>
        </div>
      </div>
    </article>
  )
}
