import { describe, expect, it } from 'vitest'

import { markdownLinkHrefs, markdownToRichText } from './from-markdown'
import type {
  MarkdownLinkTarget,
  MarkdownToRichTextOptions,
} from './from-markdown'
import { serializeMarkdown } from './markdown'

const ID = '7f1c2a40-1111-4b2c-9d3e-0a1b2c3d4e5f'
const OTHER = '0b9e8d7c-2222-4a1b-8c3d-5e6f7a8b9c0d'

/** The resolver's answer for one href, as the batch lookup gives it. */
function targets(
  entries: Record<string, Partial<MarkdownLinkTarget> & { entryId: string }>,
): Map<string, MarkdownLinkTarget> {
  return new Map(
    Object.entries(entries).map(([href, target]) => [
      href,
      {
        collection: 'coffees',
        anchor: null,
        href: '/coffees/ethiopia',
        ...target,
      },
    ]),
  )
}

/** The link marks of the first paragraph's text nodes, with the text they cover. */
function linkMarks(
  markdown: string,
  options: MarkdownToRichTextOptions = {},
): { text?: string; attrs: Record<string, unknown> }[] {
  const doc = markdownToRichText(markdown, options) as {
    content: {
      content?: {
        text?: string
        marks?: { type: string; attrs?: Record<string, unknown> }[]
      }[]
    }[]
  }
  return (doc.content[0].content ?? []).flatMap((node) =>
    (node.marks ?? [])
      .filter((mark) => mark.type === 'link')
      .map((mark) => ({ text: node.text, attrs: mark.attrs ?? {} })),
  )
}

describe('entry links in Markdown import', () => {
  it('turns an entry: link into an entry link when the id resolved', () => {
    const map = targets({
      [`entry:${ID}`]: { entryId: ID, href: '/coffees/ethiopia' },
    })
    expect(
      linkMarks(`Read [the origin](entry:${ID}) first.`, {
        linkTargets: map,
      }),
    ).toEqual([
      {
        text: 'the origin',
        attrs: {
          href: '/coffees/ethiopia',
          entryId: ID,
          collection: 'coffees',
          anchor: null,
        },
      },
    ])
  })

  it('keeps the section of an entry: link as the anchor', () => {
    const map = targets({
      [`entry:${ID}#origin`]: {
        entryId: ID,
        anchor: 'origin',
        href: '/coffees/ethiopia#origin',
      },
    })
    const [link] = linkMarks(`[the origin](entry:${ID}#origin)`, {
      linkTargets: map,
    })
    expect(link.attrs).toEqual({
      href: '/coffees/ethiopia#origin',
      entryId: ID,
      collection: 'coffees',
      anchor: 'origin',
    })
  })

  it('keeps the text and warns with the id when no entry matches', () => {
    const warnings: string[] = []
    const marks = linkMarks(`See [the origin](entry:${OTHER}) now.`, {
      onWarning: (message) => warnings.push(message),
    })
    expect(marks).toEqual([])
    expect(warnings).toEqual([
      `Removed the link to entry "${OTHER}": no entry of this site has that id, or it has no page. The text is kept.`,
    ])
  })

  it('warns about an entry: href whose id is malformed', () => {
    const warnings: string[] = []
    linkMarks('[x](entry:not%20an%20id)', {
      onWarning: (message) => warnings.push(message),
    })
    expect(warnings).toEqual([
      'Removed the link to entry "not%20an%20id": no entry of this site has that id, or it has no page. The text is kept.',
    ])
  })

  it('turns a site path into an entry link when a page matches it', () => {
    const map = targets({
      '/coffees/ethiopia#origin': {
        entryId: ID,
        anchor: 'origin',
        href: '/coffees/ethiopia#origin',
      },
    })
    const warnings: string[] = []
    const [link] = linkMarks('[origin](/coffees/ethiopia#origin)', {
      linkTargets: map,
      onWarning: (message) => warnings.push(message),
    })
    expect(link.attrs).toMatchObject({ entryId: ID, anchor: 'origin' })
    expect(warnings).toEqual([])
  })

  it('keeps a site path that matches no page as a plain link, with no warning', () => {
    const warnings: string[] = []
    const [link] = linkMarks('[later](/coffees/later)', {
      linkTargets: new Map(),
      onWarning: (message) => warnings.push(message),
    })
    expect(link.attrs).toEqual({ href: '/coffees/later' })
    expect(warnings).toEqual([])
  })

  it('keeps a path that more than one entry answers to as a plain link, with a warning', () => {
    const warnings: string[] = []
    const [link] = linkMarks('[contact](/coffees/dup)', {
      linkTargets: new Map([['/coffees/dup', { ambiguous: true }]]),
      onWarning: (message) => warnings.push(message),
    })
    expect(link.attrs).toEqual({ href: '/coffees/dup' })
    expect(warnings).toEqual([
      'The link to /coffees/dup matches more than one page; use entry:<id>.',
    ])
  })

  it('keeps a path with a query string as a plain link, even when it is in the map', () => {
    // The resolver never maps a query: it stays plain (decision 12, as in the editor).
    const [link] = linkMarks('[search](/coffees?q=ethiopia)', {
      linkTargets: new Map(),
    })
    expect(link.attrs).toEqual({ href: '/coffees?q=ethiopia' })
  })

  it('keeps a same-page anchor as a plain link', () => {
    const [link] = linkMarks('[faq](#faq)', { linkTargets: new Map() })
    expect(link.attrs).toEqual({ href: '#faq' })
  })

  it('still drops a disallowed href with the usual warning', () => {
    const warnings: string[] = []
    const marks = linkMarks('[x](//evil.com)', {
      onWarning: (message) => warnings.push(message),
    })
    expect(marks).toEqual([])
    expect(warnings).toEqual([
      'Removed the link to "//evil.com": links must be https://, mailto:, a site path like /page or an anchor like #section.',
    ])
  })

  it('reports every link href as written, through onLink', () => {
    const seen: string[] = []
    markdownToRichText(
      `[a](entry:${ID}) [b](/coffees/x#y) [c](https://example.com) \`[d](/not-a-link)\``,
      { onLink: (href) => seen.push(href) },
    )
    expect(seen).toEqual([`entry:${ID}`, '/coffees/x#y', 'https://example.com'])
  })
})

describe('markdownLinkHrefs', () => {
  it('lists the distinct links of a text, and not code', () => {
    expect(
      markdownLinkHrefs(
        `[a](entry:${ID}) and [b](entry:${ID}) and \`[c](/x)\``,
      ),
    ).toEqual([`entry:${ID}`])
  })
})

describe('entry links round trip through Markdown', () => {
  it('writes an entry link as entry:<id> and reads it back to the same link', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'the origin',
              marks: [
                {
                  type: 'link',
                  attrs: {
                    href: '/coffees/ethiopia#origin',
                    entryId: ID,
                    collection: 'coffees',
                    anchor: 'origin',
                  },
                },
              ],
            },
          ],
        },
      ],
    }
    const markdown = serializeMarkdown(doc)
    expect(markdown).toBe(`[the origin](entry:${ID}#origin)`)
    const back = markdownToRichText(markdown, {
      linkTargets: targets({
        [`entry:${ID}#origin`]: {
          entryId: ID,
          anchor: 'origin',
          href: '/coffees/ethiopia#origin',
        },
      }),
    })
    expect(back.content[0]).toEqual(doc.content[0])
  })
})
