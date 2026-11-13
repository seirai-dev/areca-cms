import { Editor } from '@tiptap/core'
import type { JSONContent } from '@tiptap/core'
import { afterEach, describe, expect, it } from 'vitest'

import { entryLinkTargets } from '#/server/richtext/entry-links'
import { richTextExtensions } from '#/server/richtext/extensions'

import {
  entryLinkAttrs,
  plainLinkAttrs,
  readLinkMarkAttrs,
  setLinkMark,
} from './link-mark'

/** A headless editor with the real rich text extensions, holding one entry link. */
function editorWithEntryLink(): Editor {
  const content: JSONContent = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: 'Visit us',
            marks: [
              {
                type: 'link',
                attrs: {
                  href: '/blog/coffee-ethiopia',
                  entryId: 'entry-1',
                  collection: 'articles',
                  anchor: 'origin',
                },
              },
            ],
          },
        ],
      },
    ],
  }
  return new Editor({ extensions: richTextExtensions, content })
}

/** The link mark on the text "Visit us" of the first paragraph. */
function linkOf(editor: Editor) {
  const text = editor.state.doc.firstChild?.firstChild
  return text?.marks.find((mark) => mark.type.name === 'link')?.attrs
}

const range = { from: 1, to: 9 }

let editor: Editor | null = null
afterEach(() => {
  editor?.destroy()
  editor = null
})

describe('replacing an entry link with a plain link', () => {
  it.each([
    ['https://example.com', 'https://example.com'],
    ['#local', '#local'],
  ])(
    'drops the entry attributes when the link becomes %s',
    (typed, expectedHref) => {
      editor = editorWithEntryLink()
      expect(linkOf(editor)).toMatchObject({ entryId: 'entry-1' })

      setLinkMark(editor, range, plainLinkAttrs(typed), 'Visit us')

      const link = linkOf(editor)
      expect(link?.href).toBe(expectedHref)
      expect(link?.entryId ?? null).toBeNull()
      expect(link?.collection ?? null).toBeNull()
      expect(link?.anchor ?? null).toBeNull()
      // What the save sees: no entry link, so nothing recomputes the href.
      expect(entryLinkTargets(editor.getJSON())).toEqual([])
    },
  )

  it('keeps every entry attribute when the link becomes another entry', () => {
    editor = editorWithEntryLink()
    setLinkMark(
      editor,
      range,
      entryLinkAttrs('/blog/kenya', 'entry-2', 'articles', null),
      'Visit us',
    )
    expect(linkOf(editor)).toMatchObject({
      href: '/blog/kenya',
      entryId: 'entry-2',
      collection: 'articles',
      anchor: null,
    })
  })
})

describe('readLinkMarkAttrs', () => {
  it('reads the entry link under the selection', () => {
    editor = editorWithEntryLink()
    editor.commands.setTextSelection(3)
    expect(readLinkMarkAttrs(editor)).toEqual({
      href: '/blog/coffee-ethiopia',
      entryId: 'entry-1',
      collection: 'articles',
      anchor: 'origin',
    })
  })

  it('reads a plain link with null entry attributes, and an empty anchor as none', () => {
    editor = editorWithEntryLink()
    setLinkMark(
      editor,
      range,
      { ...plainLinkAttrs('https://example.com'), anchor: '' },
      'Visit us',
    )
    editor.commands.setTextSelection(3)
    expect(readLinkMarkAttrs(editor)).toEqual(
      plainLinkAttrs('https://example.com'),
    )
  })

  it('is null without a link under the selection', () => {
    editor = new Editor({
      extensions: richTextExtensions,
      content: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'No links here' }],
          },
        ],
      },
    })
    editor.commands.setTextSelection(3)
    expect(readLinkMarkAttrs(editor)).toBeNull()
  })
})
