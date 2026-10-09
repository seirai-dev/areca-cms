import type { ImageValue, SeoMeta } from './types.js'

export type HeadMeta =
  | { title: string }
  | { name: string; content: string }
  | { property: string; content: string }

export type HeadLink = { rel: string; href: string }

export type HeadScript = { type: string; children: string }

export type SeoHeadOptions = {
  /** `'%s · Acme'` (the first `%s` is replaced) or a function. */
  titleTemplate?: string | ((title: string) => string)
  /** Overrides `og:site_name`. */
  siteName?: string
}

export type SeoHeadResult = {
  title: string | undefined
  meta: HeadMeta[]
  links: HeadLink[]
  scripts: HeadScript[]
}

function present(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

function applyTemplate(title: string, template: SeoHeadOptions['titleTemplate']): string {
  if (!template) return title
  return typeof template === 'function' ? template(title) : template.replace('%s', () => title)
}

/**
 * Serialises each JSON-LD object so it is safe inside an inline
 * `<script type="application/ld+json">`.
 */
export function seoJsonLd(seo: SeoMeta | null | undefined): string[] {
  if (!seo || !Array.isArray(seo.jsonLd)) return []
  return seo.jsonLd.map((item) =>
    JSON.stringify(item)
      .replace(/</g, '\\u003c')
      .replace(/>/g, '\\u003e')
      .replace(/&/g, '\\u0026')
      .replace(/\u2028/g, '\\u2028')
      .replace(/\u2029/g, '\\u2029'),
  )
}

/** Head data shaped for TanStack Router's `head()` route option. */
export function seoHead(
  seo: SeoMeta | null | undefined,
  options: SeoHeadOptions = {},
): SeoHeadResult {
  const result: SeoHeadResult = { title: undefined, meta: [], links: [], scripts: [] }
  if (!seo) return result

  const meta = result.meta
  const name = (n: string, content: string | null | undefined) => {
    if (present(content)) meta.push({ name: n, content })
  }
  const property = (p: string, content: string | number | null | undefined) => {
    if (content === null || content === undefined) return
    const text = String(content)
    if (present(text)) meta.push({ property: p, content: text })
  }
  const image = (img: ImageValue | null, prefix: 'og' | 'twitter') => {
    if (!img || !present(img.url)) return
    if (prefix === 'og') {
      property('og:image', img.url)
      property('og:image:width', img.width)
      property('og:image:height', img.height)
      property('og:image:alt', img.alt)
      property('og:image:type', img.mimeType)
    } else {
      name('twitter:image', img.url)
      name('twitter:image:alt', img.alt)
    }
  }

  if (present(seo.title)) {
    result.title = applyTemplate(seo.title, options.titleTemplate)
    meta.push({ title: result.title })
  }
  name('description', seo.description)
  name('robots', seo.robots?.content)
  if (present(seo.canonicalUrl)) result.links.push({ rel: 'canonical', href: seo.canonicalUrl })

  const og = seo.openGraph
  if (og) {
    property('og:type', og.type)
    property('og:title', og.title)
    property('og:description', og.description)
    property('og:url', og.url)
    property('og:site_name', options.siteName ?? og.siteName)
    image(og.image, 'og')
    property('article:published_time', og.publishedTime)
    property('article:modified_time', og.modifiedTime)
  }
  if (seo.author) {
    property('article:author', present(seo.author.url) ? seo.author.url : seo.author.name)
  }

  const tw = seo.twitter
  if (tw) {
    name('twitter:card', tw.card)
    name('twitter:title', tw.title)
    name('twitter:description', tw.description)
    image(tw.image, 'twitter')
  }

  result.scripts = seoJsonLd(seo).map((children) => ({
    type: 'application/ld+json',
    children,
  }))
  return result
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Head tags as an HTML string, for Astro or any plain SSR template. */
export function seoHeadHtml(seo: SeoMeta | null | undefined, options: SeoHeadOptions = {}): string {
  const head = seoHead(seo, options)
  const lines: string[] = []
  for (const entry of head.meta) {
    if ('title' in entry) {
      lines.push(`<title>${escapeHtml(entry.title)}</title>`)
    } else if ('name' in entry) {
      lines.push(`<meta name="${escapeHtml(entry.name)}" content="${escapeHtml(entry.content)}">`)
    } else {
      lines.push(
        `<meta property="${escapeHtml(entry.property)}" content="${escapeHtml(entry.content)}">`,
      )
    }
  }
  for (const link of head.links) {
    lines.push(`<link rel="${escapeHtml(link.rel)}" href="${escapeHtml(link.href)}">`)
  }
  for (const script of head.scripts) {
    // children is already escaped for inline script use
    lines.push(`<script type="${escapeHtml(script.type)}">${script.children}</script>`)
  }
  return lines.join('\n')
}
