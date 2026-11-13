import { describe, expect, it } from 'vitest'

import { richTextPlainText } from './richtext-text'

describe('richTextPlainText', () => {
  it('puts blocks on their own lines', () => {
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
    expect(richTextPlainText(doc)).toBe(
      'Spring launch\nOur new collection\nis here.',
    )
  })

  it('keeps image alt text and returns empty for no content', () => {
    expect(
      richTextPlainText({
        type: 'doc',
        content: [
          { type: 'image', attrs: { src: 'x.png', alt: 'A field' } },
          { type: 'paragraph', content: [{ type: 'text', text: 'Caption' }] },
        ],
      }),
    ).toBe('A field\nCaption')
    expect(richTextPlainText(null)).toBe('')
    expect(richTextPlainText(undefined)).toBe('')
    expect(richTextPlainText('just a string')).toBe('')
    expect(richTextPlainText({ type: 'doc', content: [] })).toBe('')
  })
})
