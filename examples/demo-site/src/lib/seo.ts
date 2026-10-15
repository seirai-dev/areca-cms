import { seoHead } from '@areca-cms/site-sdk'
import type { SeoMeta } from '@areca-cms/site-sdk'
import { currentLocale, hreflangLinks, originOf, BASE_LOCALE } from './i18n.ts'
import type { Alternates } from './i18n.ts'

export const SITE_NAME = 'Northbound Coffee Co.'
export const SITE_DESCRIPTION =
  'Small-batch specialty coffee, roasted in Bergen, Norway on a 15 kg Giesen.'
export const TITLE_TEMPLATE = `%s · ${SITE_NAME}`
/**
 * The demo's production origin. Hreflang alternates are absolute URLs, so they
 * need it on pages without a CMS canonical URL. A canonical URL's origin wins.
 */
export const SITE_URL = 'https://areca-demo.emirkaan-web.eu'

const siteOptions = { titleTemplate: TITLE_TEMPLATE, siteName: SITE_NAME }

type HeadMeta =
  | { title: string }
  | { name: string; content: string }
  | { property: string; content: string }

export type PageMeta = {
  /** Page title without the site suffix. Omit for the home page. */
  title?: string | null
  description?: string | null
  type?: 'website' | 'article'
}

/** Head for pages the site owns (home, lists, about, not-found). `alternates` adds hreflang links. */
export function pageHead(page: PageMeta, alternates?: Alternates): {
  meta: HeadMeta[]
  links: ReturnType<typeof hreflangLinks>
} {
  const title = page.title ? `${page.title} · ${SITE_NAME}` : SITE_NAME
  const type = page.type ?? 'website'
  return {
    meta: [
      { title },
      ...(page.description
        ? [{ name: 'description', content: page.description }]
        : []),
      { property: 'og:title', content: title },
      ...(page.description
        ? [{ property: 'og:description', content: page.description }]
        : []),
      { property: 'og:type', content: type },
      { property: 'og:site_name', content: SITE_NAME },
      { property: 'og:locale', content: ogLocale(currentLocale()) },
    ],
    links: hreflangLinks(alternates, SITE_URL),
  }
}

/** `og:locale` form of a tag: `nl` becomes `nl_NL`, `en` becomes `en_GB`. */
function ogLocale(tag: string): string {
  return tag === 'nl' ? 'nl_NL' : 'en_GB'
}

/** A CMS entry as the head needs it: its SEO block and the language it is served in. */
type HeadEntry = { seo?: SeoMeta | null; locale?: string }

/**
 * Head for a CMS entry. Uses the CMS-resolved SEO block when the entry carries
 * one; otherwise the page fallback. `alternates` are the entry's languages as
 * full paths (see `entryAlternates`) and become hreflang links.
 */
export function entryHead(entry: HeadEntry, fallback: PageMeta, alternates?: Alternates) {
  if (entry.seo) {
    return seoHead(entry.seo, {
      ...siteOptions,
      locale: entry.locale ?? currentLocale(),
      alternates,
      main: BASE_LOCALE,
      siteUrl: originOf(entry.seo.canonicalUrl) ?? SITE_URL,
    })
  }
  return pageHead(fallback, alternates)
}

/**
 * Head for a site content section: its SEO block when the section has SEO on,
 * otherwise the page fallback. `alternates` are the page's language paths.
 */
export function sectionHead(
  seo: SeoMeta | null | undefined,
  fallback: PageMeta,
  alternates?: Alternates,
) {
  if (seo) {
    return seoHead(seo, {
      ...siteOptions,
      locale: currentLocale(),
      alternates,
      main: BASE_LOCALE,
      siteUrl: originOf(seo.canonicalUrl) ?? SITE_URL,
    })
  }
  return pageHead(fallback, alternates)
}

/** Marks a head as a draft: not indexable, whatever the page's SEO block says. */
export function noindexHead<H extends { meta: ReadonlyArray<object> }>(head: H): H {
  const meta = head.meta.filter((entry) => (entry as { name?: string }).name !== 'robots')
  return {
    ...head,
    meta: [...meta, { name: 'robots', content: 'noindex, nofollow' }],
  } as H
}
