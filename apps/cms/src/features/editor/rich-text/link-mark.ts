import type { Editor } from '@tiptap/react'

/**
 * Setting the link mark of the rich text editor (docs/design/rich-text-links.md,
 * decision 13). Pure apart from the editor it is given, so tests can run it on
 * a headless TipTap editor with the real extensions.
 */

/**
 * The mark attributes of a link. Every entry attribute is always present: a
 * plain link has null for each of them. TipTap's `setLink` merges the
 * attributes of the mark it replaces, so an entry attribute left out here
 * would survive into the new link.
 */
export type LinkMarkAttrs = {
  href: string
  entryId: string | null
  collection: string | null
  anchor: string | null
}

export type LinkRange = { from: number; to: number }

/**
 * The attributes of a link to a page, a site path, an anchor or a web address.
 * The entry attributes are set to null, not left out: replacing an entry link
 * must clear them (see setLinkMark).
 */
export function plainLinkAttrs(href: string): LinkMarkAttrs {
  return { href, entryId: null, collection: null, anchor: null }
}

/** The attributes of a link to an entry, at the whole page or at a section. */
export function entryLinkAttrs(
  href: string,
  entryId: string,
  collection: string,
  anchor: string | null,
): LinkMarkAttrs {
  return { href, entryId, collection, anchor }
}

/**
 * The link under the selection, or null when there is none. An empty anchor
 * reads as none (the whole page).
 */
export function readLinkMarkAttrs(editor: Editor): LinkMarkAttrs | null {
  const attrs = editor.getAttributes('link') as Record<string, unknown>
  const href = typeof attrs.href === 'string' ? attrs.href : ''
  if (!href) return null
  return {
    href,
    entryId: typeof attrs.entryId === 'string' ? attrs.entryId : null,
    collection: typeof attrs.collection === 'string' ? attrs.collection : null,
    anchor:
      typeof attrs.anchor === 'string' && attrs.anchor !== ''
        ? attrs.anchor
        : null,
  }
}

/**
 * Puts the link on `range`. With nothing selected and no link under the cursor,
 * inserts `text` as the link and returns the range it now covers; otherwise
 * returns null. Does not focus the editor (focusing closes the popover).
 */
export function setLinkMark(
  editor: Editor,
  range: LinkRange,
  attrs: LinkMarkAttrs,
  text: string,
): LinkRange | null {
  if (range.from === range.to && !editor.isActive('link')) {
    editor
      .chain()
      .insertContent({ type: 'text', text, marks: [{ type: 'link', attrs }] })
      .run()
    const end = editor.state.selection.from
    return { from: end - text.length, to: end }
  }
  editor
    .chain()
    .setTextSelection(range)
    .extendMarkRange('link')
    .setLink(attrs)
    .run()
  return null
}
