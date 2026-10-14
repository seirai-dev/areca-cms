import { seoHead } from '@areca-cms/site-sdk'
import type { SeoMeta, SnapshotEntry } from '@areca-cms/site-sdk'

export const SITE_NAME = 'Northbound Coffee Co.'
export const SITE_DESCRIPTION =
  'Small-batch specialty coffee, roasted in Bergen, Norway on a 15 kg Giesen.'
export const TITLE_TEMPLATE = `%s · ${SITE_NAME}`

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

/** Head for pages the site owns (home, lists, about, not-found). */
export function pageHead(page: PageMeta): { meta: HeadMeta[] } {
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
    ],
  }
}

/**
 * Head for a CMS entry. Uses the CMS-resolved SEO block when the snapshot
 * carries one; older snapshots fall back to the entry's own fields.
 */
export function entryHead(entry: SnapshotEntry, fallback: PageMeta) {
  if (entry.seo) return seoHead(entry.seo, siteOptions)
  return pageHead(fallback)
}

/**
 * Head for a site content section: its SEO block when the section has SEO on,
 * otherwise the page fallback.
 */
export function sectionHead(seo: SeoMeta | null | undefined, fallback: PageMeta) {
  if (seo) return seoHead(seo, siteOptions)
  return pageHead(fallback)
}

/** Marks a head as a draft: not indexable, whatever the page's SEO block says. */
export function noindexHead<H extends { meta: ReadonlyArray<object> }>(head: H): H {
  const meta = head.meta.filter((entry) => (entry as { name?: string }).name !== 'robots')
  return {
    ...head,
    meta: [...meta, { name: 'robots', content: 'noindex, nofollow' }],
  } as H
}
