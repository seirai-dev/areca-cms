// One call per route gives a page its full SEO and GEO head:
//
//   head: () => seo({ path: '/docs', title: 'Docs', description: '…' })
//
// Site-wide facts live in ./config.ts. JSON-LD builders for page-specific
// structured data are re-exported from ./schema.ts. Sitemap, robots.txt and
// llms.txt are generated from the built pages by scripts/seo.mjs.
import { site } from './config'
import { absoluteUrl, buildHead } from './head'
import type { PageSeo } from './head'
import { organization, website } from './schema'

export function seo(page: PageSeo) {
  return buildHead(site, page, [organization(site), website(site)])
}

/** Absolute URL on this site, for structured data fields. */
export const url = (path: string) => absoluteUrl(site, path)

export { site }
export type { Crumb, PageSeo, SeoImage } from './head'
export * from './schema'
