import { describe, expect, it } from 'vitest'

import {
  entryPublicUrl,
  entrySeoSchema,
  resolveEntrySeo,
  truncateText,
  withoutSeo,
} from './seo.ts'
import type { ResolveSeoInput } from './seo.ts'
import type { ImageValue } from './types.ts'

const hero: ImageValue = {
  url: 'https://cms.test/api/assets/file/hero.jpg',
  width: 1600,
  height: 900,
  alt: 'Hero',
  mimeType: 'image/jpeg',
}

const base: ResolveSeoInput = {
  seo: {},
  title: 'Spring launch',
  fallbackDescription: 'Our spring collection is here. It has many things.',
  url: 'https://acme.test/blog/spring-launch',
  site: { name: 'Acme', url: 'https://acme.test' },
  ogImage: null,
  heroImage: hero,
  datePublished: '2026-03-01T10:00:00.000Z',
  dateModified: '2026-03-02T10:00:00.000Z',
}

describe('entrySeoSchema', () => {
  it('accepts an empty block and a full block', () => {
    expect(entrySeoSchema.safeParse({}).success).toBe(true)
    const full = entrySeoSchema.safeParse({
      title: 'T',
      description: 'D',
      canonicalUrl: 'https://acme.test/x',
      noindex: true,
      schemaType: 'BlogPosting',
      about: [{ name: 'Tea', sameAs: '' }],
      faq: [{ question: 'Q?', answer: 'A.' }],
      author: { name: 'Jane', url: '' },
      jsonLd: '{"@type":"Thing"}',
    })
    expect(full.success).toBe(true)
  })

  it('rejects unknown keys, bad URLs and invalid JSON-LD', () => {
    expect(entrySeoSchema.safeParse({ nope: 1 }).success).toBe(false)
    expect(
      entrySeoSchema.safeParse({ canonicalUrl: 'javascript:alert(1)' })
        .success,
    ).toBe(false)
    expect(entrySeoSchema.safeParse({ jsonLd: '[1,2]' }).success).toBe(false)
    expect(entrySeoSchema.safeParse({ jsonLd: '{oops' }).success).toBe(false)
    expect(entrySeoSchema.safeParse({ schemaType: 'Recipe' }).success).toBe(
      false,
    )
  })
})

describe('resolveEntrySeo', () => {
  it('falls back to the entry title, excerpt, hero image and route URL', () => {
    const seo = resolveEntrySeo(base)
    expect(seo.title).toBe('Spring launch')
    expect(seo.description).toBe(base.fallbackDescription)
    expect(seo.canonicalUrl).toBe('https://acme.test/blog/spring-launch')
    expect(seo.robots).toEqual({
      index: true,
      follow: true,
      content: 'index, follow, max-image-preview:large',
    })
    expect(seo.openGraph.image).toBe(hero)
    expect(seo.openGraph.type).toBe('article')
    expect(seo.twitter.card).toBe('summary_large_image')
    expect(seo.jsonLd).toHaveLength(1)
    expect(seo.jsonLd[0]).toMatchObject({
      '@type': 'Article',
      headline: 'Spring launch',
      image: [hero.url],
      datePublished: base.datePublished,
      publisher: { '@type': 'Organization', name: 'Acme' },
    })
    expect(seo.jsonLd[0]).not.toHaveProperty('author')
  })

  it('prefers explicit values and builds FAQ and extra JSON-LD', () => {
    const seo = resolveEntrySeo({
      ...base,
      ogImage: { ...hero, url: 'https://cms.test/og.jpg' },
      seo: {
        title: '  Custom title ',
        description: 'Custom description',
        canonicalUrl: 'https://other.test/a',
        noindex: true,
        nofollow: true,
        ogTitle: 'Share me',
        schemaType: 'WebPage',
        summary: 'Short answer.',
        keyTakeaways: [' One ', ''],
        faq: [
          { question: 'Why?', answer: 'Because.' },
          { question: '', answer: 'dropped' },
        ],
        about: [{ name: 'Tea', sameAs: 'https://www.wikidata.org/wiki/Q6097' }],
        author: { name: 'Jane', url: 'https://acme.test/jane' },
        jsonLd: '[{"@type":"BreadcrumbList"}]',
      },
    })
    expect(seo.title).toBe('Custom title')
    expect(seo.canonicalUrl).toBe('https://other.test/a')
    expect(seo.robots.content).toBe('noindex, nofollow')
    expect(seo.openGraph).toMatchObject({
      type: 'website',
      title: 'Share me',
      image: { url: 'https://cms.test/og.jpg' },
      publishedTime: null,
    })
    expect(seo.keyTakeaways).toEqual(['One'])
    expect(seo.faq).toEqual([{ question: 'Why?', answer: 'Because.' }])
    expect(seo.author).toEqual({
      name: 'Jane',
      url: 'https://acme.test/jane',
      bio: null,
    })
    expect(seo.jsonLd.map((item) => item['@type'])).toEqual([
      'WebPage',
      'FAQPage',
      'BreadcrumbList',
    ])
    expect(seo.jsonLd[0]).toMatchObject({
      name: 'Custom title',
      abstract: 'Short answer.',
      about: [{ '@type': 'Thing', name: 'Tea' }],
    })
  })

  it('uses the summary when there is no description', () => {
    const seo = resolveEntrySeo({
      ...base,
      seo: { summary: 'The summary wins over the excerpt.' },
    })
    expect(seo.description).toBe('The summary wins over the excerpt.')
  })

  it('uses a summary card without any image', () => {
    const seo = resolveEntrySeo({ ...base, heroImage: null })
    expect(seo.twitter.card).toBe('summary')
    expect(seo.jsonLd[0]).not.toHaveProperty('image')
  })
})

describe('helpers', () => {
  it('builds public URLs from the route pattern', () => {
    expect(entryPublicUrl('https://acme.test', '/blog/$slug', 'a-b')).toBe(
      'https://acme.test/blog/a-b',
    )
    expect(entryPublicUrl('https://acme.test/', '/docs', 'x')).toBe(
      'https://acme.test/docs/x',
    )
    expect(entryPublicUrl('not a url', '/$slug', 'x')).toBeNull()
  })

  it('truncates at a word boundary', () => {
    expect(truncateText('one two three four', 10)).toBe('one two…')
    expect(truncateText('  short  ', 10)).toBe('short')
  })

  it('strips the reserved key', () => {
    expect(withoutSeo({ a: 1, $seo: { title: 'x' } })).toEqual({ a: 1 })
  })
})
