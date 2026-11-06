import { describe, expect, it } from 'vitest'

import { RICHTEXT_MAX_TEXT_LENGTH } from '#/lib/content-limits'

import {
  markdownToRichText,
  normalizeRichTextInput,
  richTextToMarkdown,
} from './from-markdown'
import { validateRichText } from './validate'

const ASSET_ID = '3f2b8c1e-6a4d-4e9b-9c1a-2d7e5f8a9b0c'
const ASSET_SRC = `/api/assets/file/${ASSET_ID}.jpg`
const resolveAssetSrc = (id: string) => (id === ASSET_ID ? ASSET_SRC : null)

type Node = {
  type: string
  attrs?: Record<string, unknown>
  content?: Node[]
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>
  text?: string
}

function doc(md: string, options?: Parameters<typeof markdownToRichText>[1]) {
  return markdownToRichText(md, options) as { type: 'doc'; content: Node[] }
}

function expectValid(md: string) {
  const json = markdownToRichText(md, { resolveAssetSrc })
  expect(validateRichText(json)).toEqual([])
  return json
}

const kitchenSink = `# Title one

## Section

#### Deep

##### Clamped five

###### Clamped six

Plain paragraph with **bold**, *italic*, ***both***, and a [link](https://example.com/a?b=1).

Escaped \\* star and ~~struck~~ and \`code span\` text.

Line one\\
line two.

- bullet one
- bullet two
  - nested bullet
    - deeper bullet

1. first
2. second
   1. nested ordered

3. third

- [x] done task
- [ ] open task

> A quote with **emphasis**
>
> - and a list

\`\`\`ts
const x = 1
\`\`\`

\`\`\`
plain code
\`\`\`

---

| Name | Count |
| ---- | ----- |
| apple | 3 |
| pear | 5 |

![Hero](asset:${ASSET_ID})

![Remote](https://cdn.example.com/hero.png "Caption")

[bad](javascript:alert(1))

<div>raw html block</div>

Inline <span>html</span> here.

Final paragraph.
`

describe('markdownToRichText: basics', () => {
  it('returns a valid empty doc for empty or whitespace input', () => {
    for (const md of ['', '   \n\n  ']) {
      expect(doc(md)).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] })
      expect(validateRichText(markdownToRichText(md))).toEqual([])
    }
  })

  it('maps paragraphs with bold, italic, and nested marks', () => {
    const result = doc('plain **bold** *it* ***both***')
    const [paragraph] = result.content
    expect(paragraph.type).toBe('paragraph')
    expect(paragraph.content).toEqual([
      { type: 'text', text: 'plain ' },
      { type: 'text', text: 'bold', marks: [{ type: 'bold' }] },
      { type: 'text', text: ' ' },
      { type: 'text', text: 'it', marks: [{ type: 'italic' }] },
      { type: 'text', text: ' ' },
      {
        type: 'text',
        text: 'both',
        marks: [{ type: 'bold' }, { type: 'italic' }],
      },
    ])
  })

  it('keeps text of unsupported inline constructs as plain text', () => {
    const [paragraph] = doc('a ~~gone~~ and b').content
    expect(paragraph.content).toEqual([{ type: 'text', text: 'a gone and b' }])
  })

  it('maps inline code to a code mark', () => {
    const [paragraph] = doc('use `npm i` now').content
    expect(paragraph.content).toEqual([
      { type: 'text', text: 'use ' },
      { type: 'text', text: 'npm i', marks: [{ type: 'code' }] },
      { type: 'text', text: ' now' },
    ])
    expect(validateRichText(doc('use `npm i` now'))).toEqual([])
  })

  it('keeps a link around inline code', () => {
    const [paragraph] = doc('see [`parse()`](https://example.com)').content
    expect(paragraph.content?.at(-1)).toEqual({
      type: 'text',
      text: 'parse()',
      marks: [
        { type: 'code' },
        { type: 'link', attrs: { href: 'https://example.com' } },
      ],
    })
  })

  it('does not put bold or italic inside inline code', () => {
    const [paragraph] = doc('**bold `code`** and `*raw*`').content
    expect(paragraph.content).toEqual([
      { type: 'text', text: 'bold ', marks: [{ type: 'bold' }] },
      { type: 'text', text: 'code', marks: [{ type: 'code' }] },
      { type: 'text', text: ' and ' },
      { type: 'text', text: '*raw*', marks: [{ type: 'code' }] },
    ])
  })

  it('never emits empty text nodes', () => {
    const result = doc('**a**\n\n*b*\\\n\n***\n')
    const visit = (node: Node) => {
      if (node.type === 'text') expect(node.text?.length).toBeGreaterThan(0)
      node.content?.forEach(visit)
    }
    result.content.forEach(visit)
    expect(validateRichText(result)).toEqual([])
  })

  it('maps break to hardBreak', () => {
    const [paragraph] = doc('one\\\ntwo').content
    expect(paragraph.content).toEqual([
      { type: 'text', text: 'one' },
      { type: 'hardBreak' },
      { type: 'text', text: 'two' },
    ])
  })
})

describe('markdownToRichText: headings', () => {
  it('clamps h1 to 2 and h5/h6 to 4', () => {
    const result = doc(
      '# One\n\n## Two\n\n### Three\n\n#### Four\n\n##### Five\n\n###### Six',
    )
    expect(result.content.map((node) => node.attrs?.level)).toEqual([
      2, 2, 3, 4, 4, 4,
    ])
    expect(validateRichText(result)).toEqual([])
  })
})

describe('markdownToRichText: links', () => {
  it('keeps allowed link hrefs as link marks', () => {
    const [paragraph] = doc(
      '[site](https://example.com) and [mail](mailto:a@b.co)',
    ).content
    expect(paragraph.content?.[0]).toEqual({
      type: 'text',
      text: 'site',
      marks: [{ type: 'link', attrs: { href: 'https://example.com' } }],
    })
    expect(paragraph.content?.[2]).toEqual({
      type: 'text',
      text: 'mail',
      marks: [{ type: 'link', attrs: { href: 'mailto:a@b.co' } }],
    })
  })

  it('turns disallowed links such as javascript: into plain text', () => {
    const json = expectValid('[click](javascript:alert(1)) now')
    const [paragraph] = (json as { content: Node[] }).content
    expect(paragraph.content).toEqual([{ type: 'text', text: 'click now' }])
    expect(JSON.stringify(json)).not.toContain('javascript:')
  })
})

describe('markdownToRichText: relative links', () => {
  it('keeps site paths and anchors as link marks', () => {
    const [paragraph] = doc('[coffees](/coffees/x) and [faq](#faq)').content
    expect(paragraph.content?.[0]).toEqual({
      type: 'text',
      text: 'coffees',
      marks: [{ type: 'link', attrs: { href: '/coffees/x' } }],
    })
    expect(paragraph.content?.[2]).toEqual({
      type: 'text',
      text: 'faq',
      marks: [{ type: 'link', attrs: { href: '#faq' } }],
    })
  })

  it('drops a bad link, keeps its text and warns with the href', () => {
    const warnings: string[] = []
    const json = markdownToRichText('[click](//evil.com) now', {
      onWarning: (message) => warnings.push(message),
    })
    expect(validateRichText(json)).toEqual([])
    const [paragraph] = (json as { content: Node[] }).content
    expect(paragraph.content).toEqual([{ type: 'text', text: 'click now' }])
    expect(warnings).toEqual([
      'Removed the link to "//evil.com": links must be https://, mailto:, a site path like /page or an anchor like #section.',
    ])
  })

  it('warns once per dropped link and stays silent for allowed links', () => {
    const warnings: string[] = []
    markdownToRichText(
      '[a](javascript:alert(1)) [b](https://example.com) [c](javascript:alert(1)) [d](/ok)',
      { onWarning: (message) => warnings.push(message) },
    )
    expect(warnings).toHaveLength(2)
    expect(warnings[0]).toContain('"javascript:alert(1)"')
    expect(warnings.some((message) => message.includes('"/ok"'))).toBe(false)
  })

  it('drops links with a backslash or a space in the href', () => {
    const warnings: string[] = []
    const json = markdownToRichText('[x](</a b>) [y](/\\evil.com)', {
      onWarning: (message) => warnings.push(message),
    })
    expect(JSON.stringify(json)).not.toContain('"link"')
    expect(warnings).toHaveLength(2)
  })
})

describe('markdownToRichText: images', () => {
  it('resolves asset: references through resolveAssetSrc', () => {
    const result = doc(`![Hero](asset:${ASSET_ID})`, { resolveAssetSrc })
    expect(result.content).toEqual([
      {
        type: 'image',
        attrs: { src: ASSET_SRC, alt: 'Hero', title: null },
      },
    ])
  })

  it('drops asset: references that do not resolve', () => {
    const unknown = '00000000-0000-4000-8000-000000000000'
    const result = doc(`![Gone](asset:${unknown})`, { resolveAssetSrc })
    expect(result.content).toEqual([{ type: 'paragraph' }])
    expect(doc(`![Gone](asset:${ASSET_ID})`).content).toEqual([
      { type: 'paragraph' },
    ])
  })

  it('drops images with disallowed sources', () => {
    const result = doc(
      '![x](javascript:alert(1)) ![y](data:image/png;base64,AAAA)',
    )
    expect(JSON.stringify(result)).not.toContain('"image"')
    expect(validateRichText(result)).toEqual([])
  })

  it('keeps absolute http(s) and app-relative asset sources', () => {
    const result = doc(
      '![a](https://cdn.example.com/a.png "Title")\n\n![b](/assets/b.jpg)',
    )
    expect(result.content).toEqual([
      {
        type: 'image',
        attrs: {
          src: 'https://cdn.example.com/a.png',
          alt: 'a',
          title: 'Title',
        },
      },
      {
        type: 'image',
        attrs: { src: '/assets/b.jpg', alt: 'b', title: null },
      },
    ])
  })

  it('splits a paragraph around an inline image into block-level images', () => {
    const result = doc(`before ![pic](asset:${ASSET_ID}) after`, {
      resolveAssetSrc,
    })
    expect(result.content.map((node) => node.type)).toEqual([
      'paragraph',
      'image',
      'paragraph',
    ])
    expect(result.content[0].content).toEqual([
      { type: 'text', text: 'before' },
    ])
    expect(result.content[2].content).toEqual([{ type: 'text', text: 'after' }])
    expect(validateRichText(result)).toEqual([])
  })

  it('omits a paragraph that held only a dropped image', () => {
    const result = doc('![x](javascript:alert(1))\n\nNext')
    expect(result.content).toEqual([
      { type: 'paragraph', content: [{ type: 'text', text: 'Next' }] },
    ])
  })

  it('hoists images out of headings after the heading', () => {
    const result = doc(`## Title ![p](asset:${ASSET_ID})`, { resolveAssetSrc })
    expect(result.content.map((node) => node.type)).toEqual([
      'heading',
      'image',
    ])
    expect(validateRichText(result)).toEqual([])
  })
})

describe('markdownToRichText: lists', () => {
  it('maps bullet and ordered lists', () => {
    const result = doc('- a\n- b\n\n3. c\n4. d')
    expect(result.content.map((node) => node.type)).toEqual([
      'bulletList',
      'orderedList',
    ])
    expect(result.content[0].content?.[0]).toEqual({
      type: 'listItem',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a' }] }],
    })
    expect(result.content[1].attrs).toEqual({ start: 3 })
  })

  it('omits the start attribute for ordered lists starting at 1', () => {
    const [list] = doc('1. a\n2. b').content
    expect(list.type).toBe('orderedList')
    expect(list.attrs).toBeUndefined()
  })

  it('maps nested lists and keeps list items block-structured', () => {
    const result = doc('- parent\n  - child\n    - grandchild')
    const parent = result.content[0].content![0]
    expect(parent.content?.[0].type).toBe('paragraph')
    expect(parent.content?.[1].type).toBe('bulletList')
    const child = parent.content![1].content![0]
    expect(child.content?.[0].type).toBe('paragraph')
    expect(child.content?.[1].type).toBe('bulletList')
    expect(validateRichText(result)).toEqual([])
  })

  it('inserts a leading paragraph when an item starts with a nested list', () => {
    const result = expectValid('- - nested only')
    const item = (result as { content: Node[] }).content[0].content![0]
    expect(item.content?.[0]).toEqual({ type: 'paragraph' })
    expect(item.content?.[1].type).toBe('bulletList')
  })

  it('maps task list checkboxes to plain items', () => {
    const result = doc('- [x] done\n- [ ] open')
    const items = result.content[0].content!
    expect(items.map((item) => item.content?.[0].content)).toEqual([
      [{ type: 'text', text: 'done' }],
      [{ type: 'text', text: 'open' }],
    ])
    expect(JSON.stringify(result)).not.toMatch(/checked|\[x\]|\[ \]/)
  })
})

describe('markdownToRichText: blocks', () => {
  it('maps blockquotes', () => {
    const result = doc('> quoted **text**')
    expect(result.content[0].type).toBe('blockquote')
    expect(result.content[0].content?.[0].type).toBe('paragraph')
  })

  it('normalises fence languages and keeps unknown ones verbatim', () => {
    const language = (fence: string) =>
      doc(`${fence}\nx\n\`\`\``).content[0].attrs?.language
    expect(language('```bash')).toBe('shell')
    expect(language('```typescript')).toBe('ts')
    expect(language('```TS')).toBe('ts')
    expect(language('```text')).toBeUndefined()
    expect(language('```cobol')).toBe('cobol')
  })

  it('maps code blocks with language and without content when empty', () => {
    const result = doc('```ts\nconst a = 1\n```\n\n```\n```')
    expect(result.content[0]).toEqual({
      type: 'codeBlock',
      attrs: { language: 'ts' },
      content: [{ type: 'text', text: 'const a = 1' }],
    })
    expect(result.content[1]).toEqual({ type: 'codeBlock' })
    expect(validateRichText(result)).toEqual([])
  })

  it('maps thematic breaks to horizontal rules', () => {
    expect(doc('above\n\n---\n\nbelow').content[1]).toEqual({
      type: 'horizontalRule',
    })
  })

  it('maps raw HTML to plain text paragraphs and never emits HTML nodes', () => {
    const json = expectValid(
      '<div>raw html block</div>\n\nInline <span>x</span> here.',
    )
    expect(JSON.stringify(json)).not.toContain('"html"')
    expect(JSON.stringify(json)).toContain('raw html block')
  })
})

describe('markdownToRichText: tables', () => {
  it('maps the header row to tableHeader and body rows to tableCell', () => {
    const result = doc('| A | B |\n| - | - |\n| 1 | **2** |')
    const [table] = result.content
    expect(table.type).toBe('table')
    const [header, body] = table.content!
    expect(header.type).toBe('tableRow')
    expect(header.content!.map((cell) => cell.type)).toEqual([
      'tableHeader',
      'tableHeader',
    ])
    expect(body.content!.map((cell) => cell.type)).toEqual([
      'tableCell',
      'tableCell',
    ])
    expect(body.content![1].content).toEqual([
      {
        type: 'paragraph',
        content: [{ type: 'text', text: '2', marks: [{ type: 'bold' }] }],
      },
    ])
    expect(validateRichText(result)).toEqual([])
  })

  it('pads ragged rows so every row has the same number of cells', () => {
    const result = doc('| A | B | C |\n| - | - | - |\n| only |')
    const rows = result.content[0].content!
    expect(rows.map((row) => row.content!.length)).toEqual([3, 3])
    expect(validateRichText(result)).toEqual([])
  })
})

describe('markdownToRichText: kitchen sink', () => {
  it('produces a document that passes validateRichText with zero errors', () => {
    const json = markdownToRichText(kitchenSink, { resolveAssetSrc })
    expect(validateRichText(json)).toEqual([])
    const types = (json as { content: Node[] }).content.map((node) => node.type)
    expect(types).toEqual(
      expect.arrayContaining([
        'heading',
        'paragraph',
        'bulletList',
        'orderedList',
        'blockquote',
        'codeBlock',
        'horizontalRule',
        'table',
        'image',
      ]),
    )
  })
})

describe('richTextToMarkdown round trip', () => {
  const canonical = `## Heading

A paragraph with **bold**, *italic* and a [link](https://example.com).

- one
- two
  - nested

1. first
2. second

> quoted

\`\`\`ts
const x = 1
\`\`\`

---

| Name | Count |
| --- | --- |
| apple | 3 |

![Hero](${ASSET_SRC})`

  it('is stable: md -> doc -> md -> doc yields deep-equal docs', () => {
    const first = markdownToRichText(canonical)
    expect(validateRichText(first)).toEqual([])
    const markdown = richTextToMarkdown(first)
    const second = markdownToRichText(markdown)
    expect(second).toEqual(first)
    expect(richTextToMarkdown(second)).toBe(markdown)
  })

  it('round-trips asset images through their resolved src', () => {
    const first = markdownToRichText(`![Hero](asset:${ASSET_ID})`, {
      resolveAssetSrc,
    })
    const second = markdownToRichText(richTextToMarkdown(first))
    expect(second).toEqual(first)
  })
})

describe('normalizeRichTextInput', () => {
  it('converts non-empty strings', () => {
    expect(normalizeRichTextInput('# Hi')).toEqual(markdownToRichText('# Hi'))
  })

  it('passes documents, empty strings, nullish, and other values through', () => {
    const json = { type: 'doc', content: [] }
    expect(normalizeRichTextInput(json)).toBe(json)
    expect(normalizeRichTextInput('')).toBe('')
    expect(normalizeRichTextInput(null)).toBeNull()
    expect(normalizeRichTextInput(undefined)).toBeUndefined()
    expect(normalizeRichTextInput(42)).toBe(42)
  })

  it('forwards asset resolution options to the converter', () => {
    const result = normalizeRichTextInput(`![x](asset:${ASSET_ID})`, {
      resolveAssetSrc,
    })
    expect(JSON.stringify(result)).toContain(ASSET_SRC)
  })
})

describe('markdownToRichText limits', () => {
  it('reports oversized input through validateRichText instead of crashing', () => {
    const huge = 'x'.repeat(RICHTEXT_MAX_TEXT_LENGTH + 10)
    const json = markdownToRichText(huge)
    expect(validateRichText(json).join(' ')).toMatch(/longer than/)
  })

  it('reports too many nodes through validateRichText', () => {
    const md = Array.from({ length: 25_000 }, (_, i) => `p${i}`).join('\n\n')
    const json = markdownToRichText(md)
    expect(validateRichText(json).join(' ')).toMatch(/more than \d+ nodes/)
  })
})
