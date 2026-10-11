import { Link, createFileRoute } from '@tanstack/react-router'
import type { Author } from '../lib/content.ts'
import { ArticleCard } from '../components/article-card.tsx'
import { AuthorCard } from '../components/author-card.tsx'
import { CoffeeCard } from '../components/coffee-card.tsx'
import { CmsImage } from '../components/cms-image.tsx'
import { buttonGhostOnImage, buttonOnImage, Eyebrow, SectionHeading } from '../components/ui.tsx'
import { loadHome, loadTeam } from '../lib/queries.ts'
import { pageHead, SITE_DESCRIPTION, SITE_NAME } from '../lib/seo.ts'

export const Route = createFileRoute('/')({
  loader: async () => ({ ...(await loadHome()), authors: await loadTeam() }),
  head: () => pageHead({ description: SITE_DESCRIPTION }),
  component: Home,
})

function Home() {
  const { articles, coffees, authors } = Route.useLoaderData()
  const heroImage = articles[0]?.data.heroImage ?? coffees[0]?.data.image ?? null
  const [lead, ...rest] = articles

  return (
    <div>
      <section className="relative isolate flex min-h-[88svh] flex-col justify-end overflow-hidden bg-brand text-on-image">
        {heroImage ? (
          <CmsImage image={heroImage} priority className="absolute inset-0 -z-10 size-full object-cover" />
        ) : null}
        <div aria-hidden="true" className="absolute inset-0 -z-10 bg-linear-to-t from-[#0c120f]/92 via-[#0c120f]/70 to-[#0c120f]/25" />
        <div className="mx-auto w-full max-w-6xl px-5 pb-16 pt-40 sm:px-8 md:pb-24">
          <p className="text-[0.72rem] font-medium uppercase tracking-[0.2em] text-on-image/90">
            Roasters in Bergen, Norway
          </p>
          <h1 className="mt-5 max-w-4xl font-display text-5xl font-normal leading-[0.98] tracking-tight sm:text-6xl md:text-7xl lg:text-[5.5rem]">
            Coffee from the source, roasted on the coast.
          </h1>
          <p className="mt-6 max-w-xl text-base leading-7 text-on-image/85 md:text-lg">
            {SITE_NAME} buys directly from producers and roasts every lot in small batches on a 15 kg Giesen.
            Here is what we have on the shelf this season.
          </p>
          <div className="mt-9 flex flex-wrap gap-3">
            <Link to="/coffees" className={buttonOnImage}>
              Shop coffees
            </Link>
            <Link to="/journal" className={buttonGhostOnImage}>
              Read the journal
            </Link>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-24 sm:px-8 md:py-32" aria-labelledby="home-coffees">
        <SectionHeading
          id="home-coffees"
          eyebrow="Shop"
          title="This season's coffees"
          linkTo="/coffees"
          linkLabel="All coffees"
        />
        <div className="mt-12 grid gap-x-8 gap-y-16 md:grid-cols-3">
          {coffees.map((coffee) => (
            <CoffeeCard key={coffee.id} coffee={coffee} />
          ))}
        </div>
      </section>

      {lead ? (
        <section className="bg-surface/60 py-24 md:py-32" aria-labelledby="home-journal">
          <div className="mx-auto max-w-6xl px-5 sm:px-8">
            <SectionHeading
              id="home-journal"
              eyebrow="Journal"
              title="From the journal"
              linkTo="/journal"
              linkLabel="All articles"
            />
            <div className="mt-14 grid gap-14 lg:grid-cols-[1.6fr_1fr] lg:gap-16">
              <ArticleCard
                article={lead}
                variant="lead"
                author={authorFor(lead.data.author?.id, authors)}
              />
              <div className="flex flex-col gap-10 self-start">
                {rest.map((article) => (
                  <div key={article.id} className="border-t border-line pt-10 first:border-t-0 first:pt-0">
                    <ArticleCard
                      article={article}
                      variant="row"
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {authors.length ? (
        <section className="mx-auto max-w-6xl px-5 py-24 sm:px-8 md:py-32" aria-labelledby="home-team">
          <SectionHeading id="home-team" eyebrow="Team" title="The people behind the roast" linkTo="/team" linkLabel="Meet the team" />
          <div className="mt-14 grid gap-12 md:grid-cols-3 md:gap-8">
            {authors.map((author) => (
              <AuthorCard key={author.id} author={author} />
            ))}
          </div>
        </section>
      ) : null}

      <section className="bg-brand py-24 text-brand-ink md:py-32" aria-label="Our approach">
        <figure className="mx-auto max-w-4xl px-5 text-center sm:px-8">
          <Eyebrow className="!text-brand-ink/70">Our approach</Eyebrow>
          <blockquote className="mt-8 font-display text-4xl font-normal leading-[1.15] tracking-tight md:text-6xl">
            <p>
              “We roast every batch ourselves, and we set aside any lot that isn’t ready.”
            </p>
          </blockquote>
          <figcaption className="mt-8 text-sm text-brand-ink/75">{SITE_NAME}, Bergen</figcaption>
        </figure>
      </section>
    </div>
  )
}

function authorFor(id: string | undefined, authors: Author[]): Author | null {
  if (!id) return null
  return authors.find((author) => author.id === id) ?? null
}
