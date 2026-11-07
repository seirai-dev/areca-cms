import { getSchema } from '@tiptap/core'
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

/**
 * Runs the link parse rule on an `<a href>` element, as the editor does when
 * text is pasted. jsdom is not installed, so the element is a stub with only
 * the `href` attribute, which is all the rule reads.
 */
function parsePastedLink(href: string): unknown {
  const schema = getSchema(richTextExtensions)
  const rule = schema.marks.link.spec.parseDOM?.[0]
  const element = {
    getAttribute: (name: string) => (name === 'href' ? href : null),
  } as unknown as HTMLElement
  const getAttrs = rule?.getAttrs as ((node: unknown) => unknown) | undefined
  return getAttrs ? getAttrs(element) : false
}

describe('rich text extensions', () => {
  it('renders external links in a new tab and site paths and anchors in the same tab', () => {
    const schema = getSchema(richTextExtensions)
    const link = schema.marks.link
    const attrsFor = (href: string) => {
      const spec = link.spec.toDOM?.(link.create({ href }), true)
      return (spec as [string, Record<string, unknown>, number])[1]
    }
    for (const href of ['https://example.com', 'mailto:a@b.co']) {
      expect(attrsFor(href)).toMatchObject({
        href,
        target: '_blank',
        rel: 'noopener noreferrer',
      })
    }
    for (const href of ['/coffees/x#faq', '#faq']) {
      const attrs = attrsFor(href)
      expect(attrs).toMatchObject({ href })
      expect(attrs).not.toHaveProperty('target')
      expect(attrs).not.toHaveProperty('rel')
    }
  })

  it('keeps a pasted site path link and drops javascript: and protocol-relative links', () => {
    // The editor parses pasted <a href> with the schema's parse rule. A rule
    // that returns false leaves the text without a link.
    expect(parsePastedLink('/ok')).toMatchObject({ href: '/ok' })
    expect(parsePastedLink('javascript:alert(1)')).toBe(false)
    expect(parsePastedLink('//evil.com')).toBe(false)
    expect(parsePastedLink('/\u0085evil')).toBe(false)
  })

  it('renders a stored disallowed href with an empty href', () => {
    const link = getSchema(richTextExtensions).marks.link
    for (const href of ['javascript:alert(1)', '//evil.com', '/\u0080x']) {
      const spec = link.spec.toDOM?.(link.create({ href }), true) as [
        string,
        Record<string, unknown>,
        number,
      ]
      expect(spec[1].href).toBe('')
    }
  })

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

  it('accepts site path and anchor links, and rejects protocol-relative and backslash links', () => {
    const linkDoc = (href: string) => ({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'x',
              marks: [{ type: 'link', attrs: { href } }],
            },
          ],
        },
      ],
    })
    for (const href of [
      '/coffees/x',
      '/coffees/x#faq',
      '/search?q=a',
      '#faq',
    ]) {
      expect(validateRichText(linkDoc(href))).toEqual([])
    }
    for (const href of ['//evil.com', '/\\evil.com', '#', '/a b']) {
      expect(validateRichText(linkDoc(href))).toContain(
        'Link href uses a disallowed protocol',
      )
    }
  })

  it('rejects control, zero-width and bidi characters in link hrefs', () => {
    const linkDoc = (href: string) => ({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'x',
              marks: [{ type: 'link', attrs: { href } }],
            },
          ],
        },
      ],
    })
    for (const href of [
      '/\u0085evil',
      '/\u0080evil',
      '/\u009fevil',
      '/a​b',
      '/a‍b',
      'https://x.com/a‮b',
      'https://x.com/a⁦b',
    ]) {
      expect(validateRichText(linkDoc(href))).toContain(
        'Link href uses a disallowed protocol',
      )
      expect(() => convertRichText(linkDoc(href))).toThrow(ValidationError)
    }
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
  it('publishes site path and anchor links without a target', () => {
    const result = convertRichText({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'Coffees',
              marks: [{ type: 'link', attrs: { href: '/coffees' } }],
            },
            { type: 'text', text: ' and ' },
            {
              type: 'text',
              text: 'FAQ',
              marks: [{ type: 'link', attrs: { href: '#faq' } }],
            },
          ],
        },
      ],
    })
    expect(result.html).toContain('href="/coffees"')
    expect(result.html).toContain('href="#faq"')
    // The published html never adds a target: the site decides how to open links.
    expect(result.html).not.toContain('target=')
  })

  it('opens only external links in a new tab in the published html', () => {
    const link = (text: string, href: string) => ({
      type: 'text',
      text,
      marks: [{ type: 'link', attrs: { href } }],
    })
    const result = convertRichText({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            link('External', 'https://example.com/guide'),
            { type: 'text', text: ' ' },
            link('Coffees', '/coffees/ethiopia#origin'),
            { type: 'text', text: ' ' },
            link('FAQ', '#faq'),
            { type: 'text', text: ' ' },
            link('Mail', 'mailto:hello@example.com'),
          ],
        },
      ],
    })
    expect(result.html).toContain(
      '<a href="https://example.com/guide" target="_blank" rel="noopener noreferrer">External</a>',
    )
    expect(result.html).toContain(
      '<a href="/coffees/ethiopia#origin">Coffees</a>',
    )
    expect(result.html).toContain('<a href="#faq">FAQ</a>')
    expect(result.html).toContain('<a href="mailto:hello@example.com">Mail</a>')
    // Only the one external link gets a target.
    expect(result.html.match(/target="_blank"/g)).toHaveLength(1)
    // The Markdown export is unchanged by how the html is rendered.
    expect(result.markdown).toBe(
      '[External](https://example.com/guide) [Coffees](/coffees/ethiopia#origin) [FAQ](#faq) [Mail](mailto:hello@example.com)',
    )
  })

  it('escapes an external href and keeps the new-tab attributes', () => {
    const result = convertRichText({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'Site',
              marks: [
                {
                  type: 'link',
                  attrs: { href: 'https://example.com/?a=1&b="2"' },
                },
              ],
            },
          ],
        },
      ],
    })
    expect(result.html).toContain(
      'href="https://example.com/?a=1&amp;b=&quot;2&quot;"',
    )
    expect(result.html).toContain(
      'target="_blank" rel="noopener noreferrer">Site</a>',
    )
  })

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
    expect(result.html).toContain(
      '<span class="th-token th-keyword">const</span> x = ',
    )
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
  it('extracts prose text and skips code blocks', () => {
    expect(richTextPlainText(representativeDoc)).toBe(
      [
        'Hello',
        'A bold and italic and link.',
        'Parent',
        'Child',
        'One',
        'Two',
        'Quoted',
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
