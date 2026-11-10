// SEO and structured data for one documentation page (src/routes/docs/$.tsx).
//
// The facts come from the page's static server loader (./doc-facts.ts, run at
// build time); this module only maps them onto `seo()`, so it is safe to run
// in the browser.
import { faqPage, howTo, ids, site, techArticle, url } from '@/lib/seo'
import type { Crumb, PageSeo } from '@/lib/seo'

/** What the docs loader adds for SEO. Kept small: it is baked into JSON. */
export type DocSeoFacts = {
  /** Docs → section → page. Empty for the docs home itself. */
  crumbs: Array<Crumb>
  /** Title of the root folder the page belongs to, such as `SDK & API`. */
  section?: string
  /** Last git commit date of the MDX file (ISO). Unknown in shallow checkouts. */
  modified?: string
  proficiencyLevel?: 'Beginner'
  /** Pages of a step-by-step series, on the series' index page. */
  steps?: Array<{ name: string; path: string; text?: string }>
  /** Questions and answers from the page's accordions. */
  faq?: Array<{ question: string; answer: string }>
}

export type DocPageData = {
  url: string
  title: string
  description?: string
  markdownUrl: string
  seo: DocSeoFacts
}

export function docPageSeo(data: DocPageData): PageSeo {
  const pageUrl = url(data.url)
  const description = data.description ?? site.description
  const { crumbs, section, modified, proficiencyLevel, steps, faq } = data.seo

  return {
    path: data.url,
    title: data.title,
    description,
    ogType: 'article',
    breadcrumbs: crumbs.length > 0 ? crumbs : undefined,
    modified,
    markdown: data.markdownUrl,
    about: ids.software(site),
    mainEntity: `${pageUrl}#article`,
    schema: [
      techArticle(site, {
        url: pageUrl,
        headline: data.title,
        description,
        section,
        image: url(site.image.src),
        modified,
        proficiencyLevel,
      }),
      !!steps?.length &&
        howTo(pageUrl, {
          name: data.title,
          description,
          steps: steps.map((s) => ({ name: s.name, text: s.text, url: url(s.path) })),
        }),
      !!faq?.length && faqPage(pageUrl, faq),
    ],
  }
}
