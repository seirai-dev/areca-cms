import { describe, expect, it } from 'vitest'

import { compactSeo, previewAddress } from './seo-panel'

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
