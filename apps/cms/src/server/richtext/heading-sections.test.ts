import { describe, expect, it } from 'vitest'

import { richTextHeadingIds, richTextHeadings } from './entry-links'

const heading = (level: number, text: string) => ({
  type: 'heading',
  attrs: { level },
  content: [{ type: 'text', text }],
})
const paragraph = (text: string) => ({
  type: 'paragraph',
  content: [{ type: 'text', text }],
})

describe('richTextHeadings', () => {
  it('gives the same ids as the published document, repeats included', () => {
    const json = {
      type: 'doc',
      content: [
        heading(2, 'Veelgestelde vragen'),
        paragraph('Tekst'),
        heading(3, 'Veelgestelde vragen'),
        heading(2, 'Ethiopië & Kenia!'),
        { type: 'blockquote', content: [heading(4, 'Citaat')] },
        heading(2, 'Veelgestelde vragen'),
      ],
    }
    const headings = richTextHeadings(json)
    expect(headings.map((item) => item.id)).toEqual(richTextHeadingIds(json))
    expect(headings.map((item) => item.id)).toEqual([
      'veelgestelde-vragen',
      'veelgestelde-vragen-2',
      'ethiopie-kenia',
      'citaat',
      'veelgestelde-vragen-3',
    ])
  })

  it('returns the text and level of each heading in order', () => {
    expect(
      richTextHeadings({
        type: 'doc',
        content: [heading(2, 'Eerste'), heading(4, 'Tweede')],
      }),
    ).toEqual([
      { id: 'eerste', text: 'Eerste', level: 2 },
      { id: 'tweede', text: 'Tweede', level: 4 },
    ])
  })

  it('is empty for no document', () => {
    expect(richTextHeadings(null)).toEqual([])
    expect(
      richTextHeadings({ type: 'doc', content: [paragraph('x')] }),
    ).toEqual([])
  })
})
