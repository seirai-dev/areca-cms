import { describe, expect, it } from 'vitest'

import { markdownToRichText } from './from-markdown'
import { serializeMarkdownWithEntryLinks } from './markdown'

// Long whitespace runs used to take seconds in quadratic regexes (200k chars
// took ~18 s each). These must stay linear.
const RUN = 200_000
const BUDGET_MS = 200

function timed<T>(run: () => T): { result: T; ms: number } {
  const start = performance.now()
  const result = run()
  return { result, ms: performance.now() - start }
}

describe('rich text with long whitespace runs', () => {
  it('serializes newlines in a paragraph quickly', () => {
    const json = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: `${'\n'.repeat(RUN)}1. x` }],
        },
      ],
    }
    const { result, ms } = timed(() => serializeMarkdownWithEntryLinks(json))
    expect(ms).toBeLessThan(BUDGET_MS)
    expect(result.markdown.endsWith('1\\. x')).toBe(true)
  })

  it('serializes spaces in a table cell quickly', () => {
    const cell = (text: string) => ({
      type: 'tableCell',
      content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
    })
    const json = {
      type: 'doc',
      content: [
        {
          type: 'table',
          content: [
            { type: 'tableRow', content: [cell('a'), cell('b')] },
            {
              type: 'tableRow',
              content: [cell(`${' '.repeat(RUN)}x`), cell('y')],
            },
          ],
        },
      ],
    }
    const { result, ms } = timed(() => serializeMarkdownWithEntryLinks(json))
    expect(ms).toBeLessThan(BUDGET_MS)
    expect(result.markdown).toContain('x')
  })

  it('converts Markdown with a long run of spaces quickly', () => {
    const { result, ms } = timed(() =>
      markdownToRichText(`a${' '.repeat(RUN)}x`),
    )
    expect(ms).toBeLessThan(BUDGET_MS)
    expect(result.content).toMatchObject([{ type: 'paragraph' }])
  })
})
