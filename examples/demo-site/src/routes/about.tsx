import { createFileRoute } from '@tanstack/react-router'
import { m } from '#/paraglide/messages'
import { ArticleBody } from '../components/article-body.tsx'
import { CmsImage, PreviewBanner } from '../components/cms-image.tsx'
import { Eyebrow } from '../components/ui.tsx'
import { pageAlternates } from '../lib/i18n.ts'
import { loadAbout, sitePreviewSearch } from '../lib/queries.ts'
import { noindexHead, sectionHead } from '../lib/seo.ts'

export const Route = createFileRoute('/about')({
  validateSearch: (search) => sitePreviewSearch.parse(search),
  loaderDeps: ({ search }) => ({ arecaPreview: search.arecaPreview }),
  loader: ({ deps }) => loadAbout({ data: { arecaPreview: deps.arecaPreview } }),
  head: ({ loaderData }) => {
    const head = sectionHead(
      loaderData?.about.$seo,
      { title: m.about_title(), description: m.meta_about_description() },
      pageAlternates('/about'),
    )
    return loaderData?.noindex ? noindexHead(head) : head
  },
  component: About,
})

function About() {
  const { about, preview, incomplete } = Route.useLoaderData()
  const { heading, body, image, foundedYear, roasterCapacityKg, originsCount } = about
  const stats = [
    { label: m.stat_founded(), value: foundedYear == null ? null : String(foundedYear) },
    { label: m.stat_capacity(), value: roasterCapacityKg == null ? null : `${roasterCapacityKg} kg` },
    { label: m.stat_origins(), value: originsCount == null ? null : String(originsCount) },
  ].flatMap((stat) => (stat.value === null ? [] : [{ label: stat.label, value: stat.value }]))

  return (
    <article className="mx-auto max-w-6xl px-5 pb-28 pt-16 sm:px-8 md:pt-24">
      {preview ? <PreviewBanner incomplete={incomplete} /> : null}

      <header className="max-w-4xl">
        <Eyebrow>{m.eyebrow_about()}</Eyebrow>
        <h1 className="mt-5 font-display text-5xl leading-[1.02] tracking-tight text-ink md:text-7xl">
          {heading}
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

        <div className={image ? 'md:col-span-6 md:col-start-7' : 'md:col-span-8'}>
          {stats.length ? (
            <dl className="grid grid-cols-3 gap-6 border-y border-line py-8">
              {stats.map((stat) => (
                <div key={stat.label}>
                  <dt className="text-[0.7rem] font-medium uppercase tracking-[0.14em] text-muted">
                    {stat.label}
                  </dt>
                  <dd className="mt-2 font-display text-3xl tracking-tight text-ink md:text-4xl">
                    {stat.value}
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}
          <ArticleBody body={body} />
        </div>
      </div>
    </article>
  )
}
