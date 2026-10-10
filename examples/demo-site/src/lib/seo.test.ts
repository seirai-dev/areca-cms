import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { SeoMeta } from '@areca-cms/site-sdk'
import { ArticleView } from '../components/article-view.tsx'
import type { Article } from './content.ts'
import { articleHead } from './seo.ts'

const seo: SeoMeta = {
  title: 'CMS title',
  description: 'CMS description',
  canonicalUrl: 'https://site.test/canonical',
  robots: { index: false, follow: true, content: 'noindex, follow' },
  focusKeyphrase: 'content publishing',
  openGraph: {
    type: 'article',
    title: 'Sharing title',
    description: 'Sharing description',
    url: 'https://site.test/canonical',
    siteName: 'Acme',
    image: null,
    publishedTime: '2026-10-10T10:00:00Z',
    modifiedTime: null,
  },
  twitter: {
    card: 'summary',
    title: 'Twitter title',
    description: 'Twitter description',
    image: null,
  },
  author: {
    name: 'Editor',
    url: 'https://site.test/editor',
    bio: 'Writes content.',
  },
  summary: 'A useful summary.',
  keyTakeaways: ['Content stays consistent.'],
  faq: [
    {
      question: 'How does publishing work?',
      answer: 'A frozen snapshot is deployed.',
    },
  ],
  about: [
    { name: 'Publishing', sameAs: 'https://site.test/topics/publishing' },
  ],
  jsonLd: [
    {
      '@type': 'FAQPage',
      mainEntity: [
        {
          '@type': 'Question',
          name: 'How does publishing work?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'A frozen snapshot is deployed.',
          },
        },
      ],
    },
  ],
}
const article = {
  id: 'entry',
  slug: 'entry',
  publishedAt: null,
  seo,
  data: {
    title: 'Field title',
    excerpt: 'Field excerpt',
    heroImage: null,
    body: null,
  },
} as unknown as Article

describe('demo CMS SEO integration', () => {
  it('honors CMS metadata instead of replacing it with content-field defaults', () => {
    const head = articleHead(article)
    expect(head.meta).toContainEqual({ title: 'CMS title - Acme' })
    expect(head.meta).toContainEqual({
      name: 'description',
      content: 'CMS description',
    })
    expect(head.meta).toContainEqual({
      name: 'robots',
      content: 'noindex, follow',
    })
    expect(head.meta).toContainEqual({
      property: 'og:title',
      content: 'Sharing title',
    })
    expect(head.meta).toContainEqual({
      name: 'twitter:title',
      content: 'Twitter title',
    })
    expect('links' in head && head.links).toContainEqual({
      rel: 'canonical',
      href: seo.canonicalUrl,
    })
    expect('scripts' in head && head.scripts[0]?.children).toContain('FAQPage')
  })
  it('renders summaries, takeaways, FAQ answers, authors and topics visibly', () => {
    const html = renderToStaticMarkup(createElement(ArticleView, { article }))
    for (const text of [
      seo.summary,
      ...seo.keyTakeaways,
      seo.faq[0]!.question,
      seo.faq[0]!.answer,
      seo.author!.name,
      seo.author!.bio,
      seo.about[0]!.name,
    ])
      expect(html).toContain(text)
    expect(html).toContain('href="https://site.test/editor"')
  })
  it('keeps useful fallback metadata for snapshots without SEO', () => {
    expect(articleHead({ ...article, seo: undefined }).meta).toEqual([
      { title: 'Field title - Acme' },
      { name: 'description', content: 'Field excerpt' },
    ])
  })
})
