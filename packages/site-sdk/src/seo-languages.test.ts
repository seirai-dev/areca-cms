import { describe, expect, it } from 'vitest'
import { seoHead, seoHeadHtml } from './seo.js'
import type { SeoMeta } from './types.js'

const seo = {
  title: 'Backend developer',
  description: 'Join us',
  canonicalUrl: null,
  robots: { index: true, follow: true, content: 'index, follow' },
  focusKeyphrase: null,
  openGraph: {
    type: 'website',
    title: 'Backend developer',
    description: null,
    url: null,
    siteName: 'Acme',
    image: null,
    publishedTime: null,
    modifiedTime: null,
  },
  twitter: { card: 'summary', title: 'Backend developer', description: null, image: null },
  author: null,
  summary: null,
  keyTakeaways: [],
  faq: [],
  about: [],
  jsonLd: [],
} as SeoMeta

const alternates = {
  nl: '/vacatures/backend',
  en: '/vacancies/backend-developer',
  'nl-BE': '/vacatures/backend-be',
}

describe('seoHead: languages', () => {
  it('is unchanged without locale or alternates', () => {
    expect(seoHead(seo)).toEqual(seoHead(seo, {}))
    expect(seoHead(seo).links).toEqual([])
    expect(seoHead(seo).meta.some((entry) => 'property' in entry && entry.property === 'og:locale')).toBe(false)
  })

  it('adds og:locale for the page language', () => {
    const head = seoHead(seo, { locale: 'nl-BE' })
    expect(head.meta).toContainEqual({ property: 'og:locale', content: 'nl_BE' })
  })

  it('formats a language without a region as the bare language', () => {
    expect(seoHead(seo, { locale: 'nl' }).meta).toContainEqual({ property: 'og:locale', content: 'nl' })
  })

  it('adds hreflang alternates with x-default for the main language', () => {
    const head = seoHead(seo, { locale: 'en', alternates, main: 'nl' })
    expect(head.links).toEqual([
      { rel: 'alternate', hreflang: 'nl', href: '/vacatures/backend' },
      { rel: 'alternate', hreflang: 'en', href: '/vacancies/backend-developer' },
      { rel: 'alternate', hreflang: 'nl-BE', href: '/vacatures/backend-be' },
      { rel: 'alternate', hreflang: 'x-default', href: '/vacatures/backend' },
    ])
  })

  it('adds og:locale:alternate for every other language', () => {
    const head = seoHead(seo, { locale: 'en', alternates, main: 'nl' })
    const alternatesMeta = head.meta.filter(
      (entry) => 'property' in entry && entry.property === 'og:locale:alternate',
    )
    expect(alternatesMeta).toEqual([
      { property: 'og:locale:alternate', content: 'nl' },
      { property: 'og:locale:alternate', content: 'nl_BE' },
    ])
  })

  it('does not add x-default when the main language has no alternate', () => {
    const head = seoHead(seo, { alternates: { en: '/en' }, main: 'nl' })
    expect(head.links.map((link) => link.hreflang)).toEqual(['en'])
  })

  it('makes relative alternates absolute with siteUrl', () => {
    const head = seoHead(seo, { locale: 'en', alternates, main: 'nl', siteUrl: 'https://acme.nl' })
    expect(head.links[0]).toEqual({
      rel: 'alternate',
      hreflang: 'nl',
      href: 'https://acme.nl/vacatures/backend',
    })
  })

  it('keeps absolute alternates as they are', () => {
    const head = seoHead(seo, {
      alternates: { en: 'https://en.acme.test/jobs' },
      siteUrl: 'https://acme.nl',
    })
    expect(head.links[0]!.href).toBe('https://en.acme.test/jobs')
  })

  it('keeps existing head output when only the alternates are added', () => {
    const plain = seoHead(seo)
    const localized = seoHead(seo, { locale: 'en', alternates, main: 'nl' })
    expect(localized.title).toBe(plain.title)
    expect(localized.meta.slice(0, plain.meta.length)).toEqual(plain.meta)
    expect(localized.scripts).toEqual(plain.scripts)
  })
})

describe('seoHeadHtml: languages', () => {
  it('renders hreflang links and og:locale tags', () => {
    const html = seoHeadHtml(seo, { locale: 'en', alternates: { en: '/en', nl: '/nl' }, main: 'nl' })
    expect(html).toContain('<meta property="og:locale" content="en">')
    expect(html).toContain('<meta property="og:locale:alternate" content="nl">')
    expect(html).toContain('<link rel="alternate" hreflang="en" href="/en">')
    expect(html).toContain('<link rel="alternate" hreflang="x-default" href="/nl">')
  })
})
