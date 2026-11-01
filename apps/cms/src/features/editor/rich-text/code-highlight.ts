import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'

import { codeHighlighter, isSupportedCodeLanguage } from '#/lib/highlight'

/** Token ranges inside one code block, relative to the start of its text. */
export type CodeTokenRange = { from: number; to: number; className: string }

/**
 * Tokenises `code` for `language`. Unsupported and empty languages produce no
 * ranges, so unknown languages render without colours.
 */
export function codeTokenRanges(
  code: string,
  language: string | null | undefined,
): CodeTokenRange[] {
  if (!language || !isSupportedCodeLanguage(language) || !code) return []
  const { tokens } = codeHighlighter.tokenize(code, { lang: language })
  const ranges: CodeTokenRange[] = []
  let offset = 0
  for (const token of tokens) {
    const length = token.value.length
    if (token.className && length > 0) {
      ranges.push({
        from: offset,
        to: offset + length,
        className: `th-token th-${token.className}`,
      })
    }
    offset += length
  }
  return ranges
}

/**
 * Tokens are cached per code block node. ProseMirror keeps the same node object
 * for untouched blocks, so only blocks whose text or language changed are
 * tokenised again. The WeakMap drops entries with their nodes.
 */
const tokenCache = new WeakMap<ProseMirrorNode, CodeTokenRange[]>()

function rangesFor(node: ProseMirrorNode): CodeTokenRange[] {
  const cached = tokenCache.get(node)
  if (cached) return cached
  const ranges = codeTokenRanges(node.textContent, node.attrs.language)
  tokenCache.set(node, ranges)
  return ranges
}

/** Inline decorations for every highlighted code block in `doc`. */
export function buildCodeDecorations(doc: ProseMirrorNode): Decoration[] {
  const decorations: Decoration[] = []
  doc.descendants((node, pos) => {
    if (node.type.name !== 'codeBlock') return true
    const start = pos + 1
    for (const range of rangesFor(node)) {
      decorations.push(
        Decoration.inline(start + range.from, start + range.to, {
          class: range.className,
        }),
      )
    }
    return false
  })
  return decorations
}

export const codeHighlightKey = new PluginKey('codeHighlight')

/**
 * Colours code blocks with inline decorations. The set is rebuilt after any
 * document change, which is cheap because tokenising is cached per block.
 */
export function codeHighlightPlugin(): Plugin {
  return new Plugin({
    key: codeHighlightKey,
    state: {
      init: (_, { doc }) =>
        DecorationSet.create(doc, buildCodeDecorations(doc)),
      apply: (tr, value) =>
        tr.docChanged
          ? DecorationSet.create(tr.doc, buildCodeDecorations(tr.doc))
          : value,
    },
    props: {
      decorations(state) {
        return codeHighlightKey.getState(state)
      },
    },
  })
}
