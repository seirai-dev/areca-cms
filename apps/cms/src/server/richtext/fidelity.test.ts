import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Markdown } from '@tanstack/markdown/react'
import { renderHtml } from '@tanstack/markdown/html'
import { parseMarkdown } from '@tanstack/markdown/parser'
import type { JSONContent } from '@tiptap/core'
import { convertRichText } from './index'
import { richTextComponents } from '../../../../../packages/site-sdk/src/rich-text-react'

const text = (value: string, marks?: JSONContent['marks']): JSONContent => ({
  type: 'text',
  text: value,
  ...(marks ? { marks } : {}),
})
const paragraph = (...content: JSONContent[]): JSONContent => ({
  type: 'paragraph',
  content,
})
const doc = (...content: JSONContent[]): JSONContent => ({
  type: 'doc',
  content,
})
const normalize = (html: string) =>
  html
    .replace(/>\s+</g, '><')
    .replace(/<br\s*\/?>/g, '<br>')
    .replace(/colSpan/g, 'colspan')
    .replace(/rowSpan/g, 'rowspan')
    .replace(/<link[^>]*rel="preload"[^>]*>/g, '')
    .replace(/<\/img>/g, '')
    .replace(/<img([^>]*)\/>/g, '<img$1>')

const corpus: Array<[string, JSONContent]> = [
  [
    'literal syntax and blank paragraphs',
    doc(
      paragraph(text('**literal** [label](https://example.com)')),
      paragraph(),
      paragraph(text('- ordinary text')),
    ),
  ],
  [
    'marked whitespace',
    doc(
      paragraph(
        text(' padded ', [{ type: 'bold' }]),
        text(' x_y ', [{ type: 'italic' }]),
        text('**literal**'),
      ),
    ),
  ],
  [
    'code fences',
    doc({
      type: 'codeBlock',
      attrs: { language: 'md' },
      content: [text('```md\n# literal\n```\n~~~~')],
    }),
  ],
  [
    'nested and multiple paragraphs in list items',
    doc({
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [
            paragraph(text('first')),
            paragraph(text('second')),
            {
              type: 'orderedList',
              attrs: { start: 3 },
              content: [
                { type: 'listItem', content: [paragraph(text('nested'))] },
              ],
            },
          ],
        },
      ],
    }),
  ],
  [
    'link labels and URL punctuation',
    doc(
      paragraph(
        text('[x] and **y** ', [
          { type: 'link', attrs: { href: 'https://example.com/a(b)?q=x' } },
        ]),
        { type: 'hardBreak' },
        text('line two'),
      ),
    ),
  ],
  [
    'table cell marks and literal syntax',
    doc({
      type: 'table',
      content: [
        {
          type: 'tableRow',
          content: [
            { type: 'tableHeader', content: [paragraph(text('Header'))] },
          ],
        },
        {
          type: 'tableRow',
          content: [
            {
              type: 'tableCell',
              content: [paragraph(text('a | **b** ', [{ type: 'bold' }]))],
            },
          ],
        },
      ],
    }),
  ],
  [
    'mixed table headers, merged cells and paragraph content',
    doc({
      type: 'table',
      content: [
        {
          type: 'tableRow',
          content: [
            {
              type: 'tableCell',
              attrs: { colspan: 2, rowspan: 2 },
              content: [paragraph(text('first')), paragraph(text('second'))],
            },
            { type: 'tableHeader', content: [paragraph(text('Side header'))] },
          ],
        },
      ],
    }),
  ],
  [
    'resized image and escaped attributes',
    doc({
      type: 'image',
      attrs: {
        src: 'https://site.test/image.png?a=1&b=2',
        alt: 'Literal "alt" <x>',
        title: 'a "title"',
        width: 240,
        height: 120,
      },
    }),
  ],
  [
    'inline code, alone and inside a link',
    doc(
      paragraph(
        text('run '),
        text('npm `i`', [{ type: 'code' }]),
        text(' and '),
        text('parse()', [
          { type: 'code' },
          { type: 'link', attrs: { href: 'https://example.com/api' } },
        ]),
      ),
    ),
  ],
  [
    'highlighted code block with a known and an unknown language',
    doc(
      {
        type: 'codeBlock',
        attrs: { language: 'ts' },
        content: [text('const a: number = 1 // note')],
      },
      {
        type: 'codeBlock',
        attrs: { language: 'cobol' },
        content: [text('DISPLAY "hi".')],
      },
    ),
  ],
]

describe('editor fidelity and renderer parity', () => {
  it.each(corpus)('%s', (_name, source) => {
    const value = convertRichText(source)
    expect(
      normalize(
        renderToStaticMarkup(
          createElement(Markdown, {
            components: richTextComponents(),
            children: value.document,
          }),
        ),
      ),
    ).toBe(normalize(renderHtml(value.document)))
    expect(convertRichText(source)).toEqual(value)
    expect(JSON.parse(JSON.stringify(value.document))).toEqual(value.document)
  })
  it('does not reinterpret literal Markdown as links, images, formatting or lists', () => {
    const value = convertRichText(
      doc(
        paragraph(
          text(
            '**literal** [label](https://example.com) ![photo](https://example.com/photo.png)',
          ),
        ),
        paragraph(text('- ordinary text')),
      ),
    )
    expect(value.html).not.toMatch(/<(strong|a|img|ul)\b/)
    expect(value.html).toContain('**literal**')
    const exported = renderHtml(
      parseMarkdown(value.markdown, { frontmatter: false }),
    )
    expect(exported).not.toMatch(/<(strong|a|img|ul)\b/)
    expect(exported).toContain('- ordinary text')
  })
  it('preserves empty paragraphs, marked whitespace and complex cell blocks', () => {
    expect(convertRichText(corpus[0][1]).html).toContain('<p></p>')
    expect(convertRichText(corpus[1][1]).html).toContain(
      '<strong> padded </strong>',
    )
    const table = convertRichText(corpus[6][1]).html
    expect(table).toContain('colSpan="2"')
    expect(table).toContain('<p>first</p>\n<p>second</p>')
  })
  it('escapes image/link attributes and chooses a fence that cannot close inside code', () => {
    const code = convertRichText(corpus[2][1])
    expect(renderHtml(parseMarkdown(code.markdown))).toContain('```md')
    const image = convertRichText(
      doc({
        type: 'image',
        attrs: {
          src: 'https://example.com/a(b).png',
          alt: '[literal] **alt** "quoted"',
          title: '"caption"',
        },
      }),
    )
    expect(image.html).toContain('alt="[literal] **alt** &quot;quoted&quot;"')
    expect(image.html).toContain('title="&quot;caption&quot;"')
    expect(image.markdown).toContain('a%28b%29.png')
    expect(renderHtml(parseMarkdown(image.markdown))).toContain(
      'alt="[literal] **alt** &quot;quoted&quot;"',
    )
  })
})
