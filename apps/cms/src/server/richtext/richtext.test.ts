import { describe, expect, it } from 'vitest'

import {
  convertRichText,
  emptyRichText,
  richTextPlainText,
  validateRichText,
} from './index'

const representativeDoc = {
  type: 'doc',
  content: [
    {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: 'Hello' }],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'A ' },
        { type: 'text', marks: [{ type: 'bold' }], text: 'bold' },
        { type: 'text', text: ' and ' },
        { type: 'text', marks: [{ type: 'italic' }], text: 'italic' },
        { type: 'text', text: ' and ' },
        {
          type: 'text',
          marks: [{ type: 'link', attrs: { href: 'https://example.com' } }],
          text: 'link',
        },
        { type: 'text', text: '.' },
      ],
    },
    {
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'Parent' }] },
            {
              type: 'bulletList',
              content: [
                {
                  type: 'listItem',
                  content: [
                    { type: 'paragraph', content: [{ type: 'text', text: 'Child' }] },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
    {
      type: 'orderedList',
      content: [
        {
          type: 'listItem',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'One' }] }],
        },
        {
          type: 'listItem',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Two' }] }],
        },
      ],
    },
    {
      type: 'blockquote',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Quoted' }] }],
    },
    {
      type: 'codeBlock',
      attrs: { language: 'ts' },
      content: [{ type: 'text', text: 'const x = 1' }],
    },
    {
      type: 'image',
      attrs: { src: '/assets/photo.jpg', alt: 'A photo' },
    },
    { type: 'horizontalRule' },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Line' },
        { type: 'hardBreak' },
        { type: 'text', text: 'break' },
      ],
    },
  ],
}

describe('validateRichText', () => {
  it('accepts a valid document', () => {
    expect(validateRichText(representativeDoc)).toEqual([])
    expect(validateRichText(emptyRichText())).toEqual([])
  })

  it('rejects a non-object and a non-doc root', () => {
    expect(validateRichText('nope')).toContain('Rich text must be an object')
    expect(validateRichText({ type: 'paragraph' })).toContain('Root type must be "doc"')
  })

  it('rejects unknown nodes, script marks, javascript: links, and heading level 1', () => {
    expect(
      validateRichText({
        type: 'doc',
        content: [{ type: 'iframe' }],
      }),
    ).toContain('Unknown node type "iframe"')

    expect(
      validateRichText({
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'x', marks: [{ type: 'script' }] }],
          },
        ],
      }),
    ).toContain('Unknown mark type "script"')

    expect(
      validateRichText({
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'x',
                marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }],
              },
            ],
          },
        ],
      }),
    ).toContain('Link href uses a disallowed protocol')

    expect(
      validateRichText({
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'x',
                marks: [{ type: 'link', attrs: { href: 'https://' } }],
              },
            ],
          },
        ],
      }),
    ).toContain('Link href uses a disallowed protocol')

    expect(
      validateRichText({
        type: 'doc',
        content: [{ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'H' }] }],
      }),
    ).toContain('Heading level must be between 2 and 4')
  })

  it('rejects on* and style attrs and a disallowed image src', () => {
    expect(
      validateRichText({
        type: 'doc',
        content: [{ type: 'paragraph', attrs: { onclick: 'alert(1)' } }],
      }),
    ).toContain('Attribute "onclick" is not allowed')

    expect(
      validateRichText({
        type: 'doc',
        content: [{ type: 'paragraph', attrs: { style: 'color:red' } }],
      }),
    ).toContain('Attribute "style" is not allowed')

    expect(
      validateRichText({
        type: 'doc',
        content: [{ type: 'image', attrs: { src: 'data:image/png;base64,xxxx', alt: 'x' } }],
      }),
    ).toContain('Image src is not allowed')
  })
})

describe('convertRichText', () => {
  it('converts a representative doc to html and markdown', () => {
    const result = convertRichText(representativeDoc)

    expect(result.json).toBe(representativeDoc)
    expect(result.html).toContain('<h2>Hello</h2>')
    expect(result.html).toContain('<strong>bold</strong>')
    expect(result.html).toContain('<em>italic</em>')
    expect(result.html).toContain('href="https://example.com"')
    expect(result.html).toContain('rel="noopener noreferrer"')
    expect(result.html).toContain('target="_blank"')
    expect(result.html).toContain('<ul>')
    expect(result.html).toContain('<ol>')
    expect(result.html).toContain('<blockquote>')
    expect(result.html).toContain('Quoted')
    expect(result.html).toContain('<pre><code')
    expect(result.html).toContain('const x = 1')
    expect(result.html).toContain('src="/assets/photo.jpg"')
    expect(result.html).toContain('alt="A photo"')
    expect(result.html).toContain('<hr>')
    expect(result.html).toContain('<br')

    expect(result.markdown).toBe(
      [
        '## Hello',
        '',
        'A **bold** and _italic_ and [link](https://example.com).',
        '',
        '- Parent',
        '  - Child',
        '',
        '1. One',
        '2. Two',
        '',
        '> Quoted',
        '',
        '```ts',
        'const x = 1',
        '```',
        '',
        '![A photo](/assets/photo.jpg)',
        '',
        '---',
        '',
        'Line  ',
        'break',
      ].join('\n'),
    )
  })

  it('throws on invalid input', () => {
    expect(() => convertRichText({ type: 'doc', content: [{ type: 'script' }] })).toThrow(
      /Unknown node type "script"/,
    )
  })
})

describe('richTextPlainText', () => {
  it('extracts searchable text', () => {
    expect(richTextPlainText(representativeDoc)).toBe(
      [
        'Hello',
        'A bold and italic and link.',
        'Parent',
        'Child',
        'One',
        'Two',
        'Quoted',
        'const x = 1',
        'A photo',
        'Line',
        'break',
      ].join('\n'),
    )
  })

  it('returns an empty string for non-objects', () => {
    expect(richTextPlainText(null)).toBe('')
    expect(richTextPlainText('x')).toBe('')
  })
})

describe('emptyRichText', () => {
  it('returns an empty doc', () => {
    expect(emptyRichText()).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] })
  })
})
