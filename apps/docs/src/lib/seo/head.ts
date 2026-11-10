// Builds everything a page puts in <head> for search engines, link previews
// and AI answer engines: title, description, canonical, robots, Open Graph,
// Twitter card and one JSON-LD @graph.
//
// Shared core: apps/landing and apps/docs keep identical copies of this file
// and schema.ts. Change both together.
import type { AnyRouteMatch } from '@tanstack/react-router'
import type { SeoSite } from './config'
import { breadcrumbList, webPage } from './schema'
import type { JsonLd } from './schema'

export type Crumb = { name: string; path: string }

export type SeoImage = {
  /** Site path (`/og.png`) or absolute URL. */
  src: string
  width?: number
  height?: number
  alt?: string
}

export type PageSeo = {
  /** Path of the page on this site, such as `/docs/sdk/cli`. */
  path: string
  title: string
  description: string
  /** Use the title as is instead of the site's title template. */
  absoluteTitle?: boolean
  /** Link preview image. Defaults to the site image. */
  image?: SeoImage
  /** Open Graph type. `article` adds article dates. */
  ogType?: 'website' | 'article'
  /** schema.org type of the page node, such as `CollectionPage`. */
  pageType?: string | Array<string>
  /** @id of the thing the page is about, such as `ids.software(site)`. */
  about?: string
  /** @id of the page's main content, such as `ids.faq(url)`. */
  mainEntity?: string
  /** Trail from the home page to this page, this page last. */
  breadcrumbs?: Array<Crumb>
  /** Extra JSON-LD nodes for this page, from the builders in schema.ts. */
  schema?: Array<JsonLd | false | null | undefined>
  /** ISO dates. `modified` also becomes the sitemap lastmod. */
  published?: string
  modified?: string
  /** Keep the page out of search results, the sitemap and llms.txt. */
  noindex?: boolean
  /** A Markdown copy of the page, offered to AI tools. */
  markdown?: string
  keywords?: Array<string>
}

export type HeadTags = {
  meta: NonNullable<AnyRouteMatch['meta']>
  links: NonNullable<AnyRouteMatch['links']>
  scripts: NonNullable<AnyRouteMatch['headScripts']>
}

/** Absolute URL for a site path. Paths keep no trailing slash, except `/`. */
export function absoluteUrl(site: SeoSite, path: string): string {
  if (/^https?:\/\//.test(path)) return path
  const clean = path === '/' ? '/' : `/${path.replace(/^\/+|\/+$/g, '')}`
  return `${site.url}${clean}`
}

export function buildHead(
  site: SeoSite,
  page: PageSeo,
  siteSchema: Array<JsonLd>,
): HeadTags {
  const url = absoluteUrl(site, page.path)
  const title = page.absoluteTitle
    ? page.title
    : site.titleTemplate.replace('%s', page.title)
  const image = page.image ?? site.image
  const imageUrl = absoluteUrl(site, image.src)
  const ogType = page.ogType ?? 'website'

  const meta: HeadTags['meta'] = [
    { title },
    { name: 'description', content: page.description },
    {
      name: 'robots',
      content: page.noindex
        ? 'noindex, follow'
        : 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1',
    },
    { property: 'og:type', content: ogType },
    { property: 'og:site_name', content: site.name },
    { property: 'og:locale', content: site.ogLocale },
    { property: 'og:url', content: url },
    { property: 'og:title', content: title },
    { property: 'og:description', content: page.description },
    { property: 'og:image', content: imageUrl },
    { property: 'og:image:alt', content: image.alt ?? site.image.alt },
    { name: 'twitter:card', content: 'summary_large_image' },
    { name: 'twitter:title', content: title },
    { name: 'twitter:description', content: page.description },
    { name: 'twitter:image', content: imageUrl },
    { name: 'twitter:image:alt', content: image.alt ?? site.image.alt },
  ]
  if (image.width && image.height) {
    meta.push(
      { property: 'og:image:width', content: String(image.width) },
      { property: 'og:image:height', content: String(image.height) },
    )
  }
  if (page.keywords?.length) {
    meta.push({ name: 'keywords', content: page.keywords.join(', ') })
  }
  if (ogType === 'article') {
    if (page.published) {
      meta.push({ property: 'article:published_time', content: page.published })
    }
    if (page.modified) {
      meta.push({ property: 'article:modified_time', content: page.modified })
    }
  }
  // Read by scripts/seo.mjs for the sitemap lastmod.
  if (page.modified) {
    meta.push({ property: 'og:updated_time', content: page.modified })
  }

  const graph: Array<JsonLd> = [
    ...siteSchema,
    webPage(site, {
      url,
      type: page.pageType,
      name: title,
      description: page.description,
      image: imageUrl,
      published: page.published,
      modified: page.modified,
      hasBreadcrumb: Boolean(page.breadcrumbs?.length),
      about: page.about,
      mainEntity: page.mainEntity,
    }),
  ]
  if (page.breadcrumbs?.length) {
    graph.push(
      breadcrumbList(
        url,
        page.breadcrumbs.map((c) => ({
          name: c.name,
          url: absoluteUrl(site, c.path),
        })),
      ),
    )
  }
  for (const node of page.schema ?? []) {
    if (node) graph.push(node)
  }
  const scripts: HeadTags['scripts'] = [
    {
      type: 'application/ld+json',
      // Escaping < keeps a "</script>" inside any string from ending the tag.
      children: JSON.stringify({
        '@context': 'https://schema.org',
        '@graph': graph,
      }).replace(/</g, '\\u003c'),
    },
  ]

  const links: HeadTags['links'] = []
  // A noindex page has no canonical: the two signals contradict each other.
  if (!page.noindex) links.push({ rel: 'canonical', href: url })
  if (page.markdown) {
    links.push({
      rel: 'alternate',
      type: 'text/markdown',
      href: absoluteUrl(site, page.markdown),
      title: `${page.title} (Markdown)`,
    })
  }
  return { meta, links, scripts }
}
