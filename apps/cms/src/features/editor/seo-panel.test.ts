import { describe, expect, it } from 'vitest'

import { compactSeo, plainTextOf } from './seo-panel'

describe('plainTextOf', () => {
  it('joins text across blocks and collapses whitespace', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: 'Spring   launch' }],
        },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Our ' },
            { type: 'text', text: 'new\n\ncollection' },
          ],
        },
        { type: 'paragraph', content: [{ type: 'text', text: 'is here.' }] },
      ],
    }
    expect(plainTextOf(doc)).toBe('Spring launch Our new collection is here.')
  })

  it('ignores non-text nodes such as images and returns empty for no content', () => {
    expect(
      plainTextOf({
        type: 'doc',
        content: [
          { type: 'image', attrs: { src: 'x.png' } },
          { type: 'paragraph', content: [{ type: 'text', text: 'Caption' }] },
        ],
      }),
    ).toBe('Caption')
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
