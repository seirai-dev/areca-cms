import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { Transaction } from '@tiptap/pm/state'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

import { m } from '#/paraglide/messages'

/**
 * Marks entry links that no longer work (decision 14): a red dashed underline
 * and a tooltip. A decoration only: the stored document is not changed. The
 * React field sets the states with a transaction after it checks the links.
 */

export type DeadLinkState = 'gone' | 'missing-section'

/** Keyed by `entryId#anchor` (an empty anchor is `#`). */
export type DeadLinks = ReadonlyMap<string, DeadLinkState>

export function deadLinkKey(entryId: string, anchor: string | null) {
  return `${entryId}#${anchor ?? ''}`
}

type PluginState = { dead: DeadLinks; decorations: DecorationSet }

export const deadLinksPluginKey = new PluginKey('deadEntryLinks')

/** Decorations for every text that carries a dead entry link. */
function decorate(doc: ProseMirrorNode, dead: DeadLinks): DecorationSet {
  if (dead.size === 0) return DecorationSet.empty
  const decorations: Decoration[] = []
  doc.descendants((node, pos) => {
    if (!node.isText) return
    for (const mark of node.marks) {
      if (mark.type.name !== 'link') continue
      const entryId = mark.attrs.entryId
      if (typeof entryId !== 'string') continue
      const anchor =
        typeof mark.attrs.anchor === 'string' ? mark.attrs.anchor : null
      const state = dead.get(deadLinkKey(entryId, anchor))
      if (!state) continue
      decorations.push(
        Decoration.inline(pos, pos + node.nodeSize, {
          class: 'rich-text-link-dead',
          'data-dead-link': state,
          title:
            state === 'gone'
              ? m.editor_link_dead_page()
              : m.editor_link_dead_section(),
        }),
      )
    }
  })
  return DecorationSet.create(doc, decorations)
}

/** The transaction that sets the dead links of the document. */
export function setDeadLinks(tr: Transaction, dead: DeadLinks): Transaction {
  return tr.setMeta(deadLinksPluginKey, dead)
}

export const deadEntryLinks = Extension.create({
  name: 'deadEntryLinks',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: deadLinksPluginKey,
        state: {
          init: () => ({ dead: new Map(), decorations: DecorationSet.empty }),
          apply(tr, value: PluginState, _oldState, newState) {
            const meta = tr.getMeta(deadLinksPluginKey) as DeadLinks | undefined
            if (meta) {
              return {
                dead: meta,
                decorations: decorate(newState.doc, meta),
              }
            }
            if (!tr.docChanged || value.dead.size === 0) return value
            return {
              dead: value.dead,
              decorations: decorate(newState.doc, value.dead),
            }
          },
        },
        props: {
          decorations(state) {
            return deadLinksPluginKey.getState(state)?.decorations
          },
        },
      }),
    ]
  },
})
