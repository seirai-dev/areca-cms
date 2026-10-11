import { describe, expect, it, vi } from 'vitest'
import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { seoHead, type SeoMeta } from '@areca-cms/site-sdk'
import { ArticleView } from '../components/article-view.tsx'
import type { Article, Author, Coffee } from './content.ts'
import { entryHead, pageHead, SITE_NAME } from './seo.ts'

// Route links need a router; render them as plain anchors for markup checks.
vi.mock('@tanstack/react-router', () => ({
  Link: (props: { to: string; params?: Record<string, string>; children?: ReactNode; className?: string }) =>
    createElement(
      'a',
      { href: props.to.replace('$slug', props.params?.slug ?? ''), className: props.className },
      props.children,
    ),
}))

const seo: SeoMeta = {
  title: 'CMS title',
  description: 'CMS description',
  canonicalUrl: 'https://site.test/canonical',
  robots: { index: false, follow: true, content: 'noindex, follow' },
  focusKeyphrase: 'specialty coffee',
  openGraph: {
    type: 'article',
    title: 'Sharing title',
    description: 'Sharing description',
    url: 'https://site.test/canonical',
    siteName: 'Old site name',
    image: null,
    publishedTime: '2026-10-01T10:00:00Z',
    modifiedTime: null,
  },
  twitter: {
    card: 'summary',
    title: 'Twitter title',
    description: 'Twitter description',
    image: null,
  },
  author: null,
  summary: 'A useful summary.',
  keyTakeaways: ['Brewing lighter keeps the fruit.'],
  faq: [
    {
      question: 'How light is light?',
      answer: 'Stop the roast about a minute earlier than a washed lot.',
    },
  ],
  about: [{ name: 'Coffee roasting', sameAs: 'https://site.test/topics/roasting' }],
  jsonLd: [
    {
      '@type': 'FAQPage',
      mainEntity: [
        {
          '@type': 'Question',
          name: 'How light is light?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Stop the roast about a minute earlier than a washed lot.',
          },
        },
      ],
    },
  ],
}

const article = {
  id: 'ent_article',
  slug: 'entry',
  publishedAt: null,
  seo,
  data: {
    title: 'Field title',
    slug: 'entry',
    excerpt: 'Field excerpt',
    heroImage: null,
    body: null,
    category: 'brewing',
    author: { collection: 'authors', slug: 'ingrid-solberg', id: 'ent_author' },
    featuredCoffee: null,
    publishedAt: '2026-10-01T10:00:00Z',
  },
} as unknown as Article

const author = {
  id: 'ent_author',
  slug: 'ingrid-solberg',
  publishedAt: null,
  data: {
    name: 'Ingrid Solberg',
    slug: 'ingrid-solberg',
    role: 'Founder and head roaster',
    bio: 'Profiles every lot.',
    portrait: null,
  },
} as unknown as Author

const coffee = {
  id: 'ent_coffee',
  slug: 'ethiopia-guji-natural',
  publishedAt: null,
  data: {
    name: 'Ethiopia Guji Natural',
    slug: 'ethiopia-guji-natural',
    origin: 'Ethiopia',
    limited: true,
    price: 18.5,
    image: null,
    description: null,
  },
} as unknown as Coffee

const fallback = { title: 'Field title', description: 'Field excerpt', type: 'article' as const }

describe('demo CMS SEO integration', () => {
  it('honors CMS metadata and applies the Northbound title template and site name', () => {
    const head = entryHead(article, fallback)
    expect(head.meta).toContainEqual({ title: `CMS title · ${SITE_NAME}` })
    expect(head.meta).toContainEqual({ name: 'description', content: 'CMS description' })
    expect(head.meta).toContainEqual({ name: 'robots', content: 'noindex, follow' })
    expect(head.meta).toContainEqual({ property: 'og:title', content: 'Sharing title' })
    expect(head.meta).toContainEqual({ property: 'og:site_name', content: SITE_NAME })
    expect(head.meta).toContainEqual({ name: 'twitter:title', content: 'Twitter title' })
    expect('links' in head && head.links).toContainEqual({
      rel: 'canonical',
      href: seo.canonicalUrl,
    })
    expect((head as ReturnType<typeof seoHead>).scripts[0]?.children).toContain('FAQPage')
  })

  it('renders summary, takeaways, FAQ, topics, byline and preview banner visibly', () => {
    const html = renderToStaticMarkup(
      createElement(ArticleView, { article, author, coffee: null, preview: true }),
    )
    for (const text of [
      seo.summary!,
      ...seo.keyTakeaways,
      seo.faq[0]!.question,
      seo.faq[0]!.answer,
      seo.about[0]!.name,
      'Ingrid Solberg',
    ])
      expect(html).toContain(text)
    expect(html).toContain('href="/team/ingrid-solberg"')
    expect(html).toContain('href="https://site.test/topics/roasting"')
    expect(html).toContain('PREVIEW - draft content')
  })

  it('falls back to entry fields and page metadata for snapshots without SEO', () => {
    const head = entryHead({ ...article, seo: undefined }, fallback)
    expect(head.meta).toContainEqual({ title: `Field title · ${SITE_NAME}` })
    expect(head.meta).toContainEqual({ name: 'description', content: 'Field excerpt' })
    expect(head.meta).toContainEqual({ property: 'og:type', content: 'article' })
  })

  it('gives owned pages a title, description, website type and site name', () => {
    expect(pageHead({ title: 'Coffees', description: 'Shop.' }).meta).toEqual([
      { title: `Coffees · ${SITE_NAME}` },
      { name: 'description', content: 'Shop.' },
      { property: 'og:title', content: `Coffees · ${SITE_NAME}` },
      { property: 'og:description', content: 'Shop.' },
      { property: 'og:type', content: 'website' },
      { property: 'og:site_name', content: SITE_NAME },
    ])
    expect(pageHead({}).meta[0]).toEqual({ title: SITE_NAME })
  })

  it('exposes coffee entries to head helpers without SEO', () => {
    const head = entryHead({ ...coffee, seo: undefined }, { title: 'Ethiopia Guji Natural' })
    expect(head.meta).toContainEqual({ title: `Ethiopia Guji Natural · ${SITE_NAME}` })
  })
})
