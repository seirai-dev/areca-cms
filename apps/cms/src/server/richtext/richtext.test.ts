import { ValidationError } from '#/server/content/errors'
import { describe, expect, it } from 'vitest'

import { env } from '#/env'

import {
  convertRichText,
  emptyRichText,
  richTextPlainText,
  validateRichText,
} from './index'
import { richTextExtensions } from './extensions'

const assetOrigin = env.APP_URL.replace(/\/+$/, '')
const photoSrc = `${assetOrigin}/assets/photo.jpg`

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
                    {
                      type: 'paragraph',
                      content: [{ type: 'text', text: 'Child' }],
                    },
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
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'One' }] },
          ],
        },
        {
          type: 'listItem',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'Two' }] },
          ],
        },
      ],
    },
    {
      type: 'blockquote',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Quoted' }] },
      ],
    },
    {
      type: 'codeBlock',
      attrs: { language: 'ts' },
      content: [{ type: 'text', text: 'const x = 1' }],
    },
    {
      type: 'image',
      attrs: {
        src: '/assets/photo.jpg',
        alt: 'A photo',
        width: 480,
        height: 320,
      },
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

describe('rich text extensions', () => {
  it('enables user-controlled image resizing', () => {
    const image = richTextExtensions.find(
      (extension) => extension.name === 'image',
    )
    expect(image?.options.resize).toMatchObject({
      enabled: true,
      minWidth: 80,
      minHeight: 40,
      alwaysPreserveAspectRatio: true,
    })
  })
})

describe('validateRichText', () => {
  it('accepts a valid document', () => {
    expect(validateRichText(representativeDoc)).toEqual([])
    expect(validateRichText(emptyRichText())).toEqual([])
  })

  it('rejects a non-object and a non-doc root', () => {
    expect(validateRichText('nope')).toContain('Rich text must be an object')
    expect(validateRichText({ type: 'paragraph' })).toContain(
      'Root type must be "doc"',
    )
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
                marks: [
                  { type: 'link', attrs: { href: 'javascript:alert(1)' } },
                ],
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
        content: [
          {
            type: 'heading',
            attrs: { level: 1 },
            content: [{ type: 'text', text: 'H' }],
          },
        ],
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
        content: [
          {
            type: 'image',
            attrs: { src: 'data:image/png;base64,xxxx', alt: 'x' },
          },
        ],
      }),
    ).toContain('Image src is not allowed')
  })

  it('rejects invalid image dimensions', () => {
    expect(
      validateRichText({
        type: 'doc',
        content: [
          {
            type: 'image',
            attrs: {
              src: '/assets/photo.jpg',
              alt: 'x',
              width: 0,
              height: '100',
            },
          },
        ],
      }),
    ).toEqual([
      'Image width must be a positive number no greater than 10000',
      'Image height must be a positive number no greater than 10000',
    ])
  })
})

describe('convertRichText', () => {
  it('converts a representative doc to html and markdown', () => {
    const result = convertRichText(representativeDoc)

    expect(result.json).not.toBe(representativeDoc)
    expect(
      (
        result.json as { content: Array<{ attrs?: { src?: string } }> }
      ).content.find((node) => node.attrs?.src)?.attrs?.src,
    ).toBe(photoSrc)
    expect(result.html).toContain('<h2 id="hello">Hello</h2>')
    expect(result.html).toContain('<strong>bold</strong>')
    expect(result.html).toContain('<em>italic</em>')
    expect(result.html).toContain('href="https://example.com"')
    expect(result.html).toContain('<ul>')
    expect(result.html).toContain('<ol>')
    expect(result.html).toContain('<blockquote>')
    expect(result.html).toContain('Quoted')
    expect(result.html).toContain(
      '<pre class="tm-code" data-lang="ts"><code class="language-ts">',
    )
    expect(result.html).toContain('const x = 1')
    expect(result.html).toContain(`src="${photoSrc}"`)
    expect(result.html).toContain('alt="A photo"')
    expect(result.html).toContain('width="480"')
    expect(result.html).toContain('height="320"')
    expect(result.html).toContain('<hr>')
    expect(result.html).toContain('<br')

    expect(result.document.type).toBe('root')
    expect(result.document.children[0]).toMatchObject({
      type: 'heading',
      depth: 2,
      id: 'hello',
    })
    expect(result.document.children.map((node) => node.type)).toEqual([
      'heading',
      'paragraph',
      'list',
      'list',
      'blockquote',
      'code',
      'paragraph',
      'thematicBreak',
      'paragraph',
    ])
    expect(JSON.parse(JSON.stringify(result.document))).toEqual(result.document)

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
        `![A photo](${photoSrc})`,
        '',
        '---',
        '',
        'Line\\',
        'break',
      ].join('\n'),
    )
    expect(
      (
        result.json as {
          content: Array<{ attrs?: { width?: number; height?: number } }>
        }
      ).content.find((node) => node.attrs?.width)?.attrs,
    ).toMatchObject({ width: 480, height: 320 })
  })

  it('converts tables to markdown, document nodes, and html', () => {
    const result = convertRichText({
      type: 'doc',
      content: [
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [
                {
                  type: 'tableHeader',
                  content: [
                    {
                      type: 'paragraph',
                      content: [{ type: 'text', text: 'Name' }],
                    },
                  ],
                },
                {
                  type: 'tableHeader',
                  content: [
                    {
                      type: 'paragraph',
                      content: [{ type: 'text', text: 'Role' }],
                    },
                  ],
                },
              ],
            },
            {
              type: 'tableRow',
              content: [
                {
                  type: 'tableCell',
                  content: [
                    {
                      type: 'paragraph',
                      content: [{ type: 'text', text: 'Ada' }],
                    },
                  ],
                },
                {
                  type: 'tableCell',
                  content: [
                    {
                      type: 'paragraph',
                      content: [
                        {
                          type: 'text',
                          marks: [{ type: 'bold' }],
                          text: 'Engineer',
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    })

    expect(result.markdown).toBe(
      ['| Name | Role |', '| --- | --- |', '| Ada | **Engineer** |'].join('\n'),
    )
    expect(result.document.children[0]).toMatchObject({ type: 'table' })
    expect(result.html).toContain('<table>')
    expect(result.html).toContain('<th>Name</th>')
    expect(result.html).toContain('<strong>Engineer</strong>')
    expect(richTextPlainText(result.json)).toBe('Name\nRole\nAda\nEngineer')
  })

  it('prefixes relative asset srcs and leaves absolute srcs alone', () => {
    const relative = convertRichText({
      type: 'doc',
      content: [
        {
          type: 'image',
          attrs: { src: '/api/assets/file/org/file.png', alt: 'x' },
        },
      ],
    })
    expect(
      (relative.json as { content: Array<{ attrs: { src: string } }> })
        .content[0]?.attrs.src,
    ).toBe(`${assetOrigin}/api/assets/file/org/file.png`)
    expect(relative.html).toContain(
      `src="${assetOrigin}/api/assets/file/org/file.png"`,
    )

    const absolute = convertRichText({
      type: 'doc',
      content: [
        {
          type: 'image',
          attrs: { src: 'https://cdn.example.com/x.png', alt: 'x' },
        },
      ],
    })
    expect(
      (absolute.json as { content: Array<{ attrs: { src: string } }> })
        .content[0]?.attrs.src,
    ).toBe('https://cdn.example.com/x.png')
    expect(absolute.html).toContain('src="https://cdn.example.com/x.png"')
  })

  it('escapes raw html and drops unsafe links via TanStack Markdown', () => {
    const result = convertRichText({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: '<script>alert(1)</script> 5 > 3' }],
        },
      ],
    })
    expect(result.html).not.toContain('<script>')
    expect(result.html).toContain('&lt;script&gt;')
    expect(result.document.children[0]).toMatchObject({ type: 'paragraph' })
  })

  it('throws on invalid input', () => {
    expect(() =>
      convertRichText({ type: 'doc', content: [{ type: 'script' }] }),
    ).toThrow(/Unknown node type "script"/)
  })

  it('throws a typed ValidationError that reaches the UI', () => {
    try {
      convertRichText({ type: 'doc', content: [{ type: 'script' }] })
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError)
    }
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
    expect(emptyRichText()).toEqual({
      type: 'doc',
      content: [{ type: 'paragraph' }],
    })
  })
})
