import { describe, expect, it } from 'vitest'

import { richTextPlainText } from '#/server/richtext'

import { compactSeo, plainTextOf, previewAddress } from './seo-panel'

describe('plainTextOf', () => {
  it('is the text the server publishes: blocks on their own lines', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: 'Spring launch' }],
        },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Our ' },
            { type: 'text', text: 'new collection' },
          ],
        },
        { type: 'paragraph', content: [{ type: 'text', text: 'is here.' }] },
      ],
    }
    expect(plainTextOf(doc)).toBe('Spring launch\nOur new collection\nis here.')
    expect(plainTextOf(doc)).toBe(richTextPlainText(doc))
  })

  it('keeps image alt text and returns empty for no content', () => {
    expect(
      plainTextOf({
        type: 'doc',
        content: [
          { type: 'image', attrs: { src: 'x.png', alt: 'A field' } },
          { type: 'paragraph', content: [{ type: 'text', text: 'Caption' }] },
        ],
      }),
    ).toBe('A field\nCaption')
    expect(plainTextOf(null)).toBe('')
    expect(plainTextOf(undefined)).toBe('')
    expect(plainTextOf('just a string')).toBe('')
    expect(plainTextOf({ type: 'doc', content: [] })).toBe('')
  })
})

describe('compactSeo', () => {
  it('returns undefined when every value is empty', () => {
    expect(
      compactSeo({
        title: '',
        description: '',
        keyTakeaways: [],
        faq: [],
        noindex: false,
        author: { name: '', url: '', bio: '' },
      }),
    ).toBeUndefined()
    expect(compactSeo({})).toBeUndefined()
  })

  it('keeps whitespace as typed (controlled inputs need it; reads trim)', () => {
    expect(compactSeo({ description: '   ' })).toEqual({ description: '   ' })
  })

  it('drops empty keys and keeps meaningful ones, including true booleans', () => {
    const out = compactSeo({
      title: 'Hello',
      description: '',
      noindex: true,
      nofollow: false,
      faq: [{ question: 'Q?', answer: 'A.' }],
      author: { name: '', url: 'https://example.com/me' },
    })
    expect(out).toEqual({
      title: 'Hello',
      noindex: true,
      faq: [{ question: 'Q?', answer: 'A.' }],
      author: { name: '', url: 'https://example.com/me' },
    })
    expect(out).not.toHaveProperty('description')
    expect(out).not.toHaveProperty('nofollow')
  })
})

describe('previewAddress', () => {
  const base = {
    productionUrl: 'https://example.test',
    routePattern: '/blog/$slug',
    slug: 'hello',
  }

  it('uses the production URL and slug for an entry', () => {
    expect(previewAddress({ ...base, global: false })).toBe(
      'https://example.test/blog/hello',
    )
  })

  it('shows no address for an entry without a slug', () => {
    expect(previewAddress({ ...base, slug: '', global: false })).toBeNull()
  })

  it('uses the preview path as the address of a site content section', () => {
    expect(
      previewAddress({
        productionUrl: 'https://example.test',
        routePattern: '/about',
        slug: '',
        global: true,
      }),
    ).toBe('https://example.test/about')
  })

  it('shows no address for a section without a preview path', () => {
    expect(
      previewAddress({
        productionUrl: 'https://example.test',
        routePattern: '',
        slug: '',
        global: true,
      }),
    ).toBeNull()
  })

  it('prefers an explicit canonical URL', () => {
    expect(
      previewAddress({
        ...base,
        canonicalUrl: 'https://canonical.test/x',
        global: true,
      }),
    ).toBe('https://canonical.test/x')
  })
})
