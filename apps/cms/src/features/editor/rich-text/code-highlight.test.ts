import { getSchema } from '@tiptap/core'
import type { Decoration } from '@tiptap/pm/view'
import { DecorationSet } from '@tiptap/pm/view'
import { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { beforeAll, describe, expect, it } from 'vitest'

import { richTextExtensions } from '#/server/richtext/extensions'

import { editorExtensions } from './code-block-extension'
import { loadCodeGrammar } from './code-grammars'
import { buildCodeDecorations, codeTokenRanges } from './code-highlight'

const schema = getSchema(editorExtensions(richTextExtensions))

beforeAll(() => loadCodeGrammar('ts'))

/** The class of an inline decoration (prosemirror-view keeps it on `type`). */
function classOf(decoration: Decoration): string | undefined {
  return (decoration as unknown as { type: { attrs: { class?: string } } }).type
    .attrs.class
}

function docWith(blocks: Array<{ language: string | null; text: string }>) {
  return ProseMirrorNode.fromJSON(schema, {
    type: 'doc',
    content: blocks.map((block) => ({
      type: 'codeBlock',
      attrs: { language: block.language },
      content: block.text ? [{ type: 'text', text: block.text }] : [],
    })),
  })
}

describe('codeTokenRanges', () => {
  it('colours a supported language with the library token classes', () => {
    const ranges = codeTokenRanges('const x = 1', 'ts')
    expect(ranges).toContainEqual({
      from: 0,
      to: 5,
      className: 'th-token th-keyword',
    })
    expect(ranges.every((range) => range.from < range.to)).toBe(true)
  })

  it('returns nothing for plain text, missing and unknown languages', () => {
    expect(codeTokenRanges('const x = 1', null)).toEqual([])
    expect(codeTokenRanges('const x = 1', undefined)).toEqual([])
    expect(codeTokenRanges('const x = 1', 'cobol')).toEqual([])
    expect(codeTokenRanges('', 'ts')).toEqual([])
  })
})

describe('buildCodeDecorations', () => {
  it('adds inline decorations only inside code blocks', () => {
    const doc = docWith([
      { language: 'ts', text: 'const x = 1' },
      { language: null, text: 'const y = 2' },
    ])
    const decorations = buildCodeDecorations(doc)
    const set = DecorationSet.create(doc, decorations)
    const inFirst = set.find(1, 12)
    const inSecond = set.find(14, 26)
    expect(inFirst.length).toBeGreaterThan(0)
    expect(inSecond).toEqual([])
    // The first token starts at the start of the first block's text.
    expect(inFirst[0].from).toBe(1)
    expect(inFirst[0].to).toBe(6)
    expect(classOf(inFirst[0])).toBe('th-token th-keyword')
  })

  it('maps decorations to the block text after earlier blocks', () => {
    const doc = docWith([
      { language: 'ts', text: 'a' },
      { language: 'ts', text: 'const z = 3' },
    ])
    const set = DecorationSet.create(doc, buildCodeDecorations(doc))
    const keyword = set
      .find()
      .find((decoration) => classOf(decoration) === 'th-token th-keyword')
    // First block: 1 char of text, so its content is at 1..2, then the second
    // block opens at 2 (close token of block one is at 2), text starts at 3.
    expect(keyword).toBeDefined()
    expect(keyword?.from).toBe(doc.child(0).nodeSize + 1)
  })

  it('reuses token ranges for an unchanged block', () => {
    const doc = docWith([{ language: 'ts', text: 'let v = 1' }])
    const first = buildCodeDecorations(doc)
    const second = buildCodeDecorations(doc)
    expect(second.length).toBe(first.length)
  })
})

describe('server schema', () => {
  it('keeps codeBlock with its language attribute', () => {
    const serverSchema = getSchema(richTextExtensions)
    expect(serverSchema.nodes.codeBlock).toBeDefined()
    expect(serverSchema.nodes.codeBlock.spec.attrs).toMatchObject({
      language: { default: null },
    })
    expect(serverSchema.nodes.codeBlock.spec.marks).toBe('')
  })
})
