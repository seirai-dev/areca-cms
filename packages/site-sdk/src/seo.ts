import type { ImageValue, SeoMeta } from './types.js'

export type HeadMeta =
  | { title: string }
  | { name: string; content: string }
  | { property: string; content: string }

export type HeadLink = { rel: string; href: string; hreflang?: string }

export type HeadScript = { type: string; children: string }

export type SeoHeadOptions = {
  /** `'%s · Acme'` (the first `%s` is replaced) or a function. */
  titleTemplate?: string | ((title: string) => string)
  /** Overrides `og:site_name`. */
  siteName?: string
  /** Language of this page, e.g. `nl-BE`. Sets `og:locale`. */
  locale?: string
  /**
   * The same page in other languages, by language tag, e.g. `entry.alternates`.
   * Each becomes a `hreflang` link and an `og:locale:alternate`. The locale
   * itself is included when present.
   */
  alternates?: Partial<Record<string, string>>
  /** The site's main language. Its alternate also becomes `hreflang="x-default"`. */
  main?: string
  /** Origin used to make relative alternate hrefs absolute, e.g. `https://acme.nl`. */
  siteUrl?: string | null
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

/**
 * `og:locale` form of a language tag: `nl` stays `nl`, `nl-BE` becomes
 * `nl_BE`. Scripts are dropped, since Open Graph has no slot for them.
 */
export function ogLocale(tag: string): string {
  const [language = '', ...rest] = tag.split('-')
  const region = rest.find((part) => /^[A-Za-z]{2}$|^\d{3}$/.test(part))
  return region === undefined ? language.toLowerCase() : `${language.toLowerCase()}_${region.toUpperCase()}`
}

/** An alternate href made absolute with the site origin, when it is relative. */
function absoluteHref(href: string, siteUrl: string | null | undefined): string {
  if (!siteUrl || !href.startsWith('/')) return href
  try {
    return new URL(href, siteUrl).toString()
  } catch {
    return href
  }
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

  languageHead(result, options)
  result.scripts = seoJsonLd(seo).map((children) => ({
    type: 'application/ld+json',
    children,
  }))
  return result
}

/** `og:locale`, `og:locale:alternate` and the `hreflang` links, when the page is localized. */
function languageHead(result: SeoHeadResult, options: SeoHeadOptions): void {
  const { locale, main, siteUrl } = options
  if (locale !== undefined) result.meta.push({ property: 'og:locale', content: ogLocale(locale) })
  for (const [tag, href] of Object.entries(options.alternates ?? {})) {
    if (href === undefined || href === null || href === '') continue
    result.links.push({ rel: 'alternate', hreflang: tag, href: absoluteHref(href, siteUrl) })
    if (tag !== locale) {
      result.meta.push({ property: 'og:locale:alternate', content: ogLocale(tag) })
    }
  }
  const fallback = main === undefined ? undefined : options.alternates?.[main]
  if (fallback) {
    result.links.push({ rel: 'alternate', hreflang: 'x-default', href: absoluteHref(fallback, siteUrl) })
  }
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
    const hreflang = link.hreflang === undefined ? '' : ` hreflang="${escapeHtml(link.hreflang)}"`
    lines.push(`<link rel="${escapeHtml(link.rel)}"${hreflang} href="${escapeHtml(link.href)}">`)
  }
  for (const script of head.scripts) {
    // children is already escaped for inline script use
    lines.push(`<script type="${escapeHtml(script.type)}">${script.children}</script>`)
  }
  return lines.join('\n')
}
