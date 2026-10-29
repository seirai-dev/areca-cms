import { Link, createFileRoute } from '@tanstack/react-router'
import { m } from '#/paraglide/messages'
import { useLivePreview } from '@areca-cms/site-sdk/visual-react'
import { ArticleCard } from '../components/article-card.tsx'
import { AuthorCard } from '../components/author-card.tsx'
import { CoffeeCard } from '../components/coffee-card.tsx'
import { CmsImage, PreviewBanner } from '../components/cms-image.tsx'
import { buttonGhostOnImage, buttonOnImage, Eyebrow, SectionHeading } from '../components/ui.tsx'
import { pageAlternates } from '../lib/i18n.ts'
import { loadHome, loadLiveHome, loadTeam, sitePreviewSearch } from '../lib/queries.ts'
import { noindexHead, sectionHead, SITE_NAME } from '../lib/seo.ts'
import { useField } from '../lib/visual-markers.tsx'

export const Route = createFileRoute('/')({
  validateSearch: (search) => sitePreviewSearch.parse(search),
  loaderDeps: ({ search }) => ({ arecaPreview: search.arecaPreview }),
  loader: async ({ deps }) => ({
    ...(await loadHome({ data: { arecaPreview: deps.arecaPreview } })),
    authors: await loadTeam(),
  }),
  head: ({ loaderData }) => {
    const head = sectionHead(
      loaderData?.home.$seo,
      { description: m.meta_home_description() },
      pageAlternates('/'),
    )
    return loaderData?.noindex ? noindexHead(head) : head
  },
  component: Home,
})

function Home() {
  const loaded = Route.useLoaderData()
  // Shows the saved draft (or the published page) until the visual editor sends unsaved values, then those.
  const { articles, coffees, authors, home, featuredCoffee, preview, incomplete } = useLivePreview({
    initial: loaded,
    cmsOrigin: loaded.cmsOrigin,
    resolve: async (result) => ({
      ...(await loadLiveHome({ data: result })),
      authors: loaded.authors,
      cmsOrigin: loaded.cmsOrigin,
    }),
  })
  const field = useField()
  const heroImage = articles[0]?.data.heroImage ?? coffees[0]?.data.image ?? null
  const [lead, ...rest] = articles

  return (
    <div>
      {preview ? (
        <div className="mx-auto max-w-6xl px-5 pt-6 sm:px-8">
          <PreviewBanner incomplete={incomplete} />
        </div>
      ) : null}

      <section className="relative isolate flex min-h-[88svh] flex-col justify-end overflow-hidden bg-brand text-on-image">
        {heroImage ? (
          <CmsImage image={heroImage} priority className="absolute inset-0 -z-10 size-full object-cover" />
        ) : null}
        <div aria-hidden="true" className="absolute inset-0 -z-10 bg-linear-to-t from-[#0c120f]/92 via-[#0c120f]/70 to-[#0c120f]/25" />
        <div className="mx-auto w-full max-w-6xl px-5 pb-16 pt-40 sm:px-8 md:pb-24">
          {home.heroEyebrow ? (
            <p
              {...field('heroEyebrow')}
              className="text-[0.72rem] font-medium uppercase tracking-[0.2em] text-on-image/90"
            >
              {home.heroEyebrow}
            </p>
          ) : null}
          <h1 className="mt-5 max-w-4xl font-display text-5xl font-normal leading-[0.98] tracking-tight sm:text-6xl md:text-7xl lg:text-[5.5rem]">
            {m.hero_title()}
          </h1>
          <p
            {...field('heroIntro')}
            className="mt-6 max-w-xl text-base leading-7 text-on-image/85 md:text-lg"
          >
            {home.heroIntro}
          </p>
          <div className="mt-9 flex flex-wrap gap-3">
            <Link to="/coffees" className={buttonOnImage}>
              {m.hero_shop_coffees()}
            </Link>
            <Link to="/journal" className={buttonGhostOnImage}>
              {m.hero_read_journal()}
            </Link>
          </div>
          {featuredCoffee ? (
            <p {...field('featuredCoffee')} className="mt-8 text-sm text-on-image/85">
              {m.featured_this_season()}{' '}
              <Link
                to="/coffees/$slug"
                params={{ slug: featuredCoffee.slug }}
                className="font-medium text-on-image underline decoration-on-image/50 underline-offset-4 transition-colors hover:decoration-on-image"
              >
                {featuredCoffee.data.name}
              </Link>
            </p>
          ) : null}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-24 sm:px-8 md:py-32" aria-labelledby="home-coffees">
        <SectionHeading
          id="home-coffees"
          eyebrow={m.eyebrow_shop()}
          title={m.home_coffees_title()}
          linkTo="/coffees"
          linkLabel={m.view_all_coffees()}
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
              eyebrow={m.eyebrow_journal()}
              title={m.from_the_journal()}
              linkTo="/journal"
              linkLabel={m.view_all_articles()}
            />
            <div className="mt-14 grid gap-14 lg:grid-cols-[1.6fr_1fr] lg:gap-16">
              <ArticleCard
                article={lead}
                variant="lead"
                author={lead.data.author}
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
          <SectionHeading
            id="home-team"
            eyebrow={m.eyebrow_team()}
            title={m.home_team_title()}
            linkTo="/team"
            linkLabel={m.meet_team()}
          />
          <div className="mt-14 grid gap-12 md:grid-cols-3 md:gap-8">
            {authors.map((author) => (
              <AuthorCard key={author.id} author={author} />
            ))}
          </div>
        </section>
      ) : null}

      <section className="bg-brand py-24 text-brand-ink md:py-32" aria-label={m.our_approach()}>
        <figure className="mx-auto max-w-4xl px-5 text-center sm:px-8">
          <Eyebrow className="!text-brand-ink/70">{m.our_approach()}</Eyebrow>
          <blockquote className="mt-8 font-display text-4xl font-normal leading-[1.15] tracking-tight md:text-6xl">
            <p>{m.quote_home()}</p>
          </blockquote>
          <figcaption className="mt-8 text-sm text-brand-ink/75">{m.quote_attribution({ name: SITE_NAME })}</figcaption>
        </figure>
      </section>
    </div>
  )
}
