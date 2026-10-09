import { describe, expect, it } from 'vitest'
import { seoHead, seoHeadHtml, seoJsonLd } from './seo.js'
import type { SeoMeta } from './types.js'

const image = {
  url: 'https://cdn.example.com/cover.jpg',
  width: 1200,
  height: 630,
  alt: 'Cover',
  mimeType: 'image/jpeg',
}

function makeSeo(overrides: Partial<SeoMeta> = {}): SeoMeta {
  return {
    title: 'Hello world',
    description: 'A description',
    canonicalUrl: 'https://example.com/blog/hello',
    robots: { index: true, follow: true, content: 'index, follow' },
    focusKeyphrase: 'hello',
    openGraph: {
      type: 'article',
      title: 'OG hello',
      description: 'OG description',
      url: 'https://example.com/blog/hello',
      siteName: 'Example',
      image,
      publishedTime: '2026-01-01T00:00:00.000Z',
      modifiedTime: '2026-01-02T00:00:00.000Z',
    },
    twitter: { card: 'summary_large_image', title: 'TW hello', description: null, image },
    author: { name: 'Ada', url: 'https://example.com/ada', bio: null },
    summary: null,
    keyTakeaways: [],
    faq: [],
    about: [],
    jsonLd: [{ '@context': 'https://schema.org', '@type': 'Article', headline: 'Hello' }],
    ...overrides,
  }
}

describe('seoHead', () => {
  it('maps a full object to head tags', () => {
    const head = seoHead(makeSeo())
    expect(head.title).toBe('Hello world')
    expect(head.meta).toEqual([
      { title: 'Hello world' },
      { name: 'description', content: 'A description' },
      { name: 'robots', content: 'index, follow' },
      { property: 'og:type', content: 'article' },
      { property: 'og:title', content: 'OG hello' },
      { property: 'og:description', content: 'OG description' },
      { property: 'og:url', content: 'https://example.com/blog/hello' },
      { property: 'og:site_name', content: 'Example' },
      { property: 'og:image', content: image.url },
      { property: 'og:image:width', content: '1200' },
      { property: 'og:image:height', content: '630' },
      { property: 'og:image:alt', content: 'Cover' },
      { property: 'og:image:type', content: 'image/jpeg' },
      { property: 'article:published_time', content: '2026-01-01T00:00:00.000Z' },
      { property: 'article:modified_time', content: '2026-01-02T00:00:00.000Z' },
      { property: 'article:author', content: 'https://example.com/ada' },
      { name: 'twitter:card', content: 'summary_large_image' },
      { name: 'twitter:title', content: 'TW hello' },
      { name: 'twitter:image', content: image.url },
      { name: 'twitter:image:alt', content: 'Cover' },
    ])
    expect(head.links).toEqual([{ rel: 'canonical', href: 'https://example.com/blog/hello' }])
    expect(head.scripts).toHaveLength(1)
    expect(head.scripts[0]?.type).toBe('application/ld+json')
    expect(JSON.parse(head.scripts[0]!.children)).toMatchObject({ '@type': 'Article' })
  })

  it('returns empty arrays for null or undefined', () => {
    for (const input of [null, undefined]) {
      expect(seoHead(input)).toEqual({ title: undefined, meta: [], links: [], scripts: [] })
    }
  })

  it('skips null and empty values and uses the author name as fallback', () => {
    const head = seoHead(
      makeSeo({
        description: null,
        canonicalUrl: '',
        author: { name: 'Ada', url: null, bio: null },
        openGraph: { ...makeSeo().openGraph, image: null, publishedTime: null },
      }),
    )
    const names = head.meta.map((m) => ('name' in m ? m.name : 'property' in m ? m.property : 'title'))
    expect(names).not.toContain('description')
    expect(names).not.toContain('og:image')
    expect(names).not.toContain('article:published_time')
    expect(head.links).toEqual([])
    expect(head.meta).toContainEqual({ property: 'article:author', content: 'Ada' })
  })

  it('applies a string title template', () => {
    const head = seoHead(makeSeo(), { titleTemplate: '%s · Acme' })
    expect(head.title).toBe('Hello world · Acme')
    expect(head.meta[0]).toEqual({ title: 'Hello world · Acme' })
    expect(head.meta).toContainEqual({ property: 'og:title', content: 'OG hello' })
  })

  it('applies a function title template', () => {
    const head = seoHead(makeSeo(), { titleTemplate: (t) => `Acme | ${t}` })
    expect(head.title).toBe('Acme | Hello world')
  })

  it('overrides og:site_name', () => {
    const head = seoHead(makeSeo(), { siteName: 'Acme' })
    expect(head.meta).toContainEqual({ property: 'og:site_name', content: 'Acme' })
  })

  it('emits noindex robots', () => {
    const head = seoHead(
      makeSeo({ robots: { index: false, follow: false, content: 'noindex, nofollow' } }),
    )
    expect(head.meta).toContainEqual({ name: 'robots', content: 'noindex, nofollow' })
  })
})

describe('seoJsonLd', () => {
  it('escapes script-breaking characters', () => {
    const [json] = seoJsonLd(
      makeSeo({ jsonLd: [{ headline: '</script><script>alert(1)</script>', x: 'a\u2028b' }] }),
    )
    expect(json).not.toContain('</script>')
    expect(json).not.toContain('<')
    expect(json).not.toContain('\u2028')
    expect(JSON.parse(json!)).toEqual({
      headline: '</script><script>alert(1)</script>',
      x: 'a\u2028b',
    })
  })

  it('returns [] without seo', () => {
    expect(seoJsonLd(null)).toEqual([])
  })
})

describe('seoHeadHtml', () => {
  it('renders tags with escaped attributes', () => {
    const html = seoHeadHtml(makeSeo({ title: 'A & B <i>', description: `Say "hi" it's` }))
    expect(html).toContain('<title>A &amp; B &lt;i&gt;</title>')
    expect(html).toContain('<meta name="description" content="Say &quot;hi&quot; it&#39;s">')
    expect(html).toContain('<link rel="canonical" href="https://example.com/blog/hello">')
    expect(html).toContain('<script type="application/ld+json">{')
  })

  it('keeps JSON-LD from closing the script tag', () => {
    const html = seoHeadHtml(makeSeo({ jsonLd: [{ a: '</script><b>' }] }))
    expect(html.match(/<\/script>/g)).toHaveLength(1)
  })

  it('returns an empty string for null', () => {
    expect(seoHeadHtml(null)).toBe('')
  })
})
