import { describe, expect, it } from 'vitest'
import { renderHtml } from '@tanstack/markdown/html'
import { parseMarkdown } from '@tanstack/markdown/parser'

import { markdownToRichText } from './from-markdown'
import { richTextDocumentFromJson } from './from-json'
import { convertRichText, richTextToMarkdown } from './index'
import { validateRichText } from './validate'

type Json = {
  type: string
  attrs?: Record<string, unknown>
  text?: string
  marks?: unknown[]
  content?: Json[]
}

const codeMark = { type: 'code' }
const linkMark = (href: string) => ({ type: 'link', attrs: { href } })

function doc(...content: Json[]) {
  return { type: 'doc', content }
}

function paragraph(...content: Json[]): Json {
  return { type: 'paragraph', content }
}

function text(value: string, marks?: unknown[]): Json {
  return { type: 'text', text: value, ...(marks ? { marks } : {}) }
}

/** Markdown → stored JSON → Markdown: the editor's save-and-read cycle. */
function roundTrip(markdown: string): string {
  return richTextToMarkdown(markdownToRichText(markdown))
}

describe('inline code round trip', () => {
  it.each([
    ['plain code', 'Run `npm install` first.'],
    ['code inside a link', 'See [`parse()`](https://example.com/docs).'],
    ['text containing a backtick', 'Use ``a`b`` as the value.'],
    ['code starting with a backtick', 'Type `` `x `` to quote.'],
    ['code ending with a backtick', 'Ends with `` x` ``.'],
    ['code with a space at each edge', 'Keep `  padded  ` spacing.'],
    ['escaped literal backtick', 'A literal \\` and `code`.'],
  ])('%s survives markdown → json → markdown', (_name, markdown) => {
    const once = roundTrip(markdown)
    // The export may pick a different backtick run or padding, but must parse
    // back to the same stored document.
    expect(markdownToRichText(once)).toEqual(markdownToRichText(markdown))
    expect(roundTrip(once)).toBe(once)
  })

  it('emits a backtick run that cannot close inside the code', () => {
    const value = doc(paragraph(text('a`b', [codeMark])))
    expect(richTextToMarkdown(value)).toBe('``a`b``')
  })

  it('pads code that starts or ends with a backtick', () => {
    const value = doc(paragraph(text('`x', [codeMark])))
    expect(richTextToMarkdown(value)).toBe('`` `x ``')
    const parsed = markdownToRichText('`` `x ``') as Json
    expect(parsed.content?.[0].content).toEqual([text('`x', [codeMark])])
  })

  it('keeps the link around code in the exported Markdown', () => {
    const value = doc(
      paragraph(
        text('see '),
        text('parse()', [codeMark, linkMark('https://example.com')]),
      ),
    )
    expect(richTextToMarkdown(value)).toBe(
      'see [`parse()`](https://example.com)',
    )
  })

  it('does not escape characters inside code', () => {
    const value = doc(paragraph(text('a*b_c[d]', [codeMark])))
    expect(richTextToMarkdown(value)).toBe('`a*b_c[d]`')
  })
})

describe('inline code in the published document', () => {
  it('builds inlineCode nodes that keep the enclosing link', () => {
    const value = doc(
      paragraph(
        text('see '),
        text('parse()', [codeMark, linkMark('https://example.com')]),
      ),
    )
    const document = richTextDocumentFromJson(value as never)
    expect(document.children[0]).toEqual({
      type: 'paragraph',
      children: [
        { type: 'text', value: 'see ' },
        {
          type: 'link',
          href: 'https://example.com',
          children: [{ type: 'inlineCode', value: 'parse()' }],
        },
      ],
    })
  })

  it('renders inline code as a <code> element and the link around it', () => {
    const result = convertRichText(
      doc(
        paragraph(
          text('see '),
          text('parse()', [codeMark, linkMark('https://example.com')]),
        ),
      ),
    )
    expect(result.html).toContain(
      '<a href="https://example.com"><code>parse()</code></a>',
    )
  })

  it('round trips inline code through the published markdown', () => {
    const result = convertRichText(
      doc(paragraph(text('Use '), text('npm i', [codeMark]), text(' here.'))),
    )
    expect(result.markdown).toBe('Use `npm i` here.')
    expect(renderHtml(parseMarkdown(result.markdown))).toBe(
      '<p>Use <code>npm i</code> here.</p>',
    )
  })
})

describe('code blocks in the published html', () => {
  it('highlights a ts block inside the tm-code wrapper', () => {
    const result = convertRichText(
      doc({
        type: 'codeBlock',
        attrs: { language: 'ts' },
        content: [{ type: 'text', text: 'const answer = 42' }],
      }),
    )
    expect(result.markdown).toBe('```ts\nconst answer = 42\n```')
    expect(result.html).toContain(
      '<pre class="tm-code" data-lang="ts"><code class="language-ts">',
    )
    expect(result.html).toContain('class="th-token th-keyword"')
    expect(result.html).toContain('class="th-token th-number"')
  })

  it('renders an unknown language without colours', () => {
    const result = convertRichText(
      doc({
        type: 'codeBlock',
        attrs: { language: 'cobol' },
        content: [{ type: 'text', text: 'DISPLAY "hi".' }],
      }),
    )
    expect(result.html).toContain('data-lang="cobol"')
    expect(result.html).not.toContain('th-token')
    expect(result.html).toContain('DISPLAY &quot;hi&quot;.')
  })
})

describe('validator and marks', () => {
  it('accepts the code mark', () => {
    expect(validateRichText(doc(paragraph(text('x', [codeMark]))))).toEqual([])
  })

  it('still rejects unknown marks', () => {
    const errors = validateRichText(
      doc(paragraph(text('x', [{ type: 'underline' }]))),
    )
    expect(errors).toContain('Unknown mark type "underline"')
  })
})

describe('plain text for descriptions', () => {
  it('skips code blocks and keeps inline code', async () => {
    const { richTextPlainText } = await import('./index')
    const { plainTextOf } = await import('#/features/editor/seo-panel')
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Call ' },
            { type: 'text', text: 'getPost', marks: [{ type: 'code' }] },
            { type: 'text', text: ' on the server.' },
          ],
        },
        {
          type: 'codeBlock',
          attrs: { language: 'ts' },
          content: [{ type: 'text', text: 'import { x } from "y"' }],
        },
        { type: 'paragraph', content: [{ type: 'text', text: 'Done.' }] },
      ],
    }
    expect(richTextPlainText(doc)).toBe('Call getPost on the server.\nDone.')
    expect(plainTextOf(doc)).toBe('Call getPost on the server. Done.')
  })
})
