import { parseMarkdown } from '@tanstack/markdown/parser'
import { describe, expect, it } from 'vitest'

import { convertRichText } from './index'
import { validateRichText } from './validate'
import { richTextDocumentFromJson } from './from-json'
import { createHeadingIds, headingSlug } from './heading-ids'
import {
  entryLinkTargets,
  remapEntryLinks,
  resolveEntryLinks,
  richTextHeadingIds,
} from './entry-links'
import { serializeMarkdown } from './markdown'

const ENTRY_ID = '7f1c2a40-1111-4b2c-9d3e-0a1b2c3d4e5f'

function linkDoc(attrs: Record<string, unknown>, text = 'Lees meer') {
  return {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text,
            marks: [
              { type: 'link', attrs: { href: '/blog/vragen', ...attrs } },
            ],
          },
        ],
      },
    ],
  }
}

describe('entry link attributes in validation', () => {
  it('accepts an entry link with its id, collection and section', () => {
    expect(
      validateRichText(
        linkDoc({
          entryId: ENTRY_ID,
          collection: 'articles',
          anchor: 'veelgestelde-vragen',
        }),
      ),
    ).toEqual([])
  })

  it('accepts null attributes, as the editor writes them for ordinary links', () => {
    expect(
      validateRichText(
        linkDoc({ entryId: null, collection: null, anchor: null }),
      ),
    ).toEqual([])
  })

  it('rejects a malformed entry id, collection or section', () => {
    expect(validateRichText(linkDoc({ entryId: 'bad id!' }))).toEqual([
      'Link entry id is not valid',
    ])
    expect(
      validateRichText(linkDoc({ entryId: ENTRY_ID, collection: '1-bad' })),
    ).toEqual(['Link collection is not valid'])
    for (const anchor of ['#faq', 'two words', 'a'.repeat(201), '']) {
      expect(validateRichText(linkDoc({ entryId: ENTRY_ID, anchor }))).toEqual([
        'Link section id is not valid',
      ])
    }
  })

  it('allows entry attributes on links only', () => {
    const bold = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'x',
              marks: [{ type: 'bold', attrs: { entryId: ENTRY_ID } }],
            },
          ],
        },
      ],
    }
    expect(validateRichText(bold)).toEqual(['Only links can point at an entry'])
  })
})

describe('heading ids match @tanstack/markdown', () => {
  // The same heading text through the library's parser and through the CMS.
  const headings = [
    'FAQ',
    'Veelgestelde vragen',
    'Café – Menu',
    'Wat is dit?',
    'Foo & Bar',
    'Hello   world',
    'Foo',
    'Foo',
    'Foo!',
    'Über uns',
    '2026 plannen',
    '***',
  ]

  it('gives every heading the library id, duplicates included', () => {
    const library = parseMarkdown(
      headings.map((text) => `## ${text}`).join('\n\n'),
    )
    const expected = library.children.flatMap((child) =>
      child.type === 'heading' ? [child.id] : [],
    )
    const next = createHeadingIds()
    expect(headings.map((text) => next(text))).toEqual(expected)
  })

  it('computes the same ids from a rich text document', () => {
    const json = {
      type: 'doc',
      content: headings.map((text) => ({
        type: 'heading',
        attrs: { level: 2 },
        content: [{ type: 'text', text }],
      })),
    }
    const document = richTextDocumentFromJson(json)
    const library = parseMarkdown(
      headings.map((text) => `## ${text}`).join('\n\n'),
    )
    const expected = library.children.flatMap((child) =>
      child.type === 'heading' ? [child.id] : [],
    )
    expect(
      document.children.flatMap((child) =>
        child.type === 'heading' ? [child.id] : [],
      ),
    ).toEqual(expected)
  })

  it('slugs like the library for a single heading', () => {
    for (const text of ['Café – Menu', 'Über uns', '***']) {
      const library = parseMarkdown(`## ${text}`).children[0]
      expect(library.type === 'heading' ? library.id : undefined).toBe(
        headingSlug(text),
      )
    }
  })

  it('finds headings nested in blockquotes and lists', () => {
    const json = {
      type: 'doc',
      content: [
        {
          type: 'blockquote',
          content: [
            {
              type: 'heading',
              attrs: { level: 3 },
              content: [{ type: 'text', text: 'Binnen' }],
            },
          ],
        },
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [
                {
                  type: 'heading',
                  attrs: { level: 2 },
                  content: [{ type: 'text', text: 'In lijst' }],
                },
              ],
            },
          ],
        },
      ],
    }
    expect(richTextHeadingIds(json)).toEqual(['binnen', 'in-lijst'])
  })
})

describe('entry link targets and resolution', () => {
  it('lists every entry link once per occurrence', () => {
    const json = linkDoc({ entryId: ENTRY_ID, anchor: 'faq' })
    expect(entryLinkTargets(json)).toEqual([
      { entryId: ENTRY_ID, anchor: 'faq' },
    ])
    expect(entryLinkTargets(linkDoc({ href: '/x' }))).toEqual([])
  })

  it('replaces the href and keeps the mark when the target resolves', async () => {
    const source = linkDoc({ entryId: ENTRY_ID, anchor: 'faq' })
    const { json, issues } = await resolveEntryLinks(source, async () => ({
      href: '/nl/vragen#faq',
      targetTitle: 'Vragen',
    }))
    const mark = (
      json as unknown as {
        content: { content: { marks: { attrs: { href: string } }[] }[] }[]
      }
    ).content[0].content[0].marks[0]
    expect(mark.attrs.href).toBe('/nl/vragen#faq')
    expect(issues).toEqual([])
    // The input is not mutated.
    expect(source.content[0].content[0].marks[0].attrs.href).toBe(
      '/blog/vragen',
    )
  })

  it('drops the mark of a link that cannot work, keeps the text, and reports it once', async () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'Een',
              marks: [
                { type: 'link', attrs: { href: '/x', entryId: ENTRY_ID } },
              ],
            },
            { type: 'text', text: ' en ' },
            {
              type: 'text',
              text: 'twee',
              marks: [
                { type: 'link', attrs: { href: '/x', entryId: ENTRY_ID } },
              ],
            },
          ],
        },
      ],
    }
    const { json, issues } = await resolveEntryLinks(doc, async () => ({
      href: null,
      reason: 'not-live',
      targetTitle: 'Concept',
    }))
    const nodes = (
      json as { content: { content: { text: string; marks?: unknown[] }[] }[] }
    ).content[0].content
    expect(nodes.map((node) => node.text)).toEqual(['Een', ' en ', 'twee'])
    expect(nodes.every((node) => !node.marks)).toBe(true)
    expect(issues).toEqual([
      {
        entryId: ENTRY_ID,
        anchor: null,
        reason: 'not-live',
        targetTitle: 'Concept',
      },
    ])
  })

  it('remaps entry ids and clears those with no target', () => {
    const json = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'a',
              marks: [
                { type: 'link', attrs: { href: '/a', entryId: 'dev-1' } },
              ],
            },
            {
              type: 'text',
              text: 'b',
              marks: [
                { type: 'link', attrs: { href: '/b', entryId: 'dev-2' } },
              ],
            },
          ],
        },
      ],
    }
    const result = remapEntryLinks(json, (id) =>
      id === 'dev-1' ? 'prod-1' : undefined,
    )
    const nodes = (
      result.json as {
        content: {
          content: { text: string; marks?: { attrs: { entryId: string } }[] }[]
        }[]
      }
    ).content[0].content
    expect(nodes[0].marks![0].attrs.entryId).toBe('prod-1')
    expect(nodes[1].marks).toBeUndefined()
    expect(result.cleared).toEqual(['dev-2'])
  })
})

describe('markdown, html and document output', () => {
  it('writes entry links as labelled references only when asked', () => {
    const json = linkDoc({
      href: '/nl/vragen#faq',
      entryId: ENTRY_ID,
      anchor: 'faq',
    })
    expect(serializeMarkdown(json)).toBe('[Lees meer](/nl/vragen#faq)')
    expect(serializeMarkdown(json, { entryLinkMarkers: true })).toBe(
      '[Lees meer][areca-entry-1]\n\n[areca-entry-1]: /nl/vragen#faq',
    )
  })

  it('keeps plain links as they were, with markers on', () => {
    const json = linkDoc({ href: 'https://example.com' })
    expect(serializeMarkdown(json, { entryLinkMarkers: true })).toBe(
      '[Lees meer](https://example.com)',
    )
  })

  it('publishes entry links with the data-areca-entry marker and no target', () => {
    const { html, document, markdown } = convertRichText(
      linkDoc({ href: '/nl/vragen#faq', entryId: ENTRY_ID, anchor: 'faq' }),
    )
    expect(html).toContain(
      `<a href="/nl/vragen#faq" data-areca-entry="${ENTRY_ID}">Lees meer</a>`,
    )
    expect(html).not.toContain('target=')
    expect(markdown).toContain('[areca-entry-1]: /nl/vragen#faq')
    expect(JSON.stringify(document)).toContain(`"entryId":"${ENTRY_ID}"`)
  })
})
