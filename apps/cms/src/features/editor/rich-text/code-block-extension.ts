import { textblockTypeInputRule } from '@tiptap/core'
import type { Editor, Extensions } from '@tiptap/core'
import { CodeBlock } from '@tiptap/extension-code-block'
import type { NodeType } from '@tiptap/pm/model'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import { ReactNodeViewRenderer } from '@tiptap/react'

import { normalizeCodeLanguage } from '#/lib/highlight'

import { CodeBlockView } from './code-block-view'
import { codeHighlightPlugin } from './code-highlight'
import { fenceOpenerLanguage, indentCode, outdentCode } from './code-block-text'
import type { CodeTextEdit } from './code-block-text'

/**
 * Editor-only behaviour for `codeBlock`. The server list (`richTextExtensions`)
 * has the same node name and `language` attribute, so stored content and the
 * schema are unchanged. Nothing here reaches the server bundle.
 */

type CodeContext = {
  start: number
  code: string
  from: number
  to: number
}

/** The selection inside the code block around the caret, or null outside it. */
function codeContext(editor: Editor, type: NodeType): CodeContext | null {
  const { $from, $to } = editor.state.selection
  if ($from.parent.type !== type) return null
  const start = $from.start()
  const end = $from.end()
  const from = $from.pos - start
  const to = Math.min($to.pos, end) - start
  return { start, code: $from.parent.textContent, from, to: Math.max(from, to) }
}

function applyCodeEdit(editor: Editor, start: number, edit: CodeTextEdit) {
  const { tr, schema } = editor.state
  if (edit.text) {
    tr.replaceWith(start + edit.from, start + edit.to, schema.text(edit.text))
  } else {
    tr.delete(start + edit.from, start + edit.to)
  }
  tr.setSelection(
    TextSelection.create(
      tr.doc,
      start + edit.selectionFrom,
      start + edit.selectionTo,
    ),
  )
  editor.view.dispatch(tr.scrollIntoView())
}

/** Tab and Shift+Tab inside a code block. Elsewhere they keep their usual job. */
function indentInCode(editor: Editor, type: NodeType, outdent: boolean) {
  const context = codeContext(editor, type)
  if (!context) return false
  const edit = outdent
    ? outdentCode(context.code, context.from, context.to)
    : indentCode(context.code, context.from, context.to)
  if (edit) applyCodeEdit(editor, context.start, edit)
  // Inside code, Tab never moves focus, even when there is nothing to remove.
  return true
}

/** A paragraph that holds only a fence opener, then Enter: make it a code block. */
function fenceParagraphToCodeBlock(editor: Editor, type: NodeType) {
  const { $from, empty } = editor.state.selection
  if (!empty || $from.parent.type.name !== 'paragraph') return false
  if ($from.parentOffset !== $from.parent.content.size) return false
  const raw = fenceOpenerLanguage($from.parent.textContent)
  if (raw === null) return false
  const from = $from.before()
  const to = $from.after()
  const language = normalizeCodeLanguage(raw) ?? null
  return editor.commands.command(({ tr }) => {
    tr.replaceWith(from, to, type.create({ language }))
    tr.setSelection(TextSelection.create(tr.doc, from + 1))
    return true
  })
}

/**
 * Paste from VS Code carries a `mode` (for example "typescript"). Normalise it
 * like every other language source, so it maps to a supported id.
 */
function vscodePastePlugin(type: NodeType) {
  return new Plugin({
    key: new PluginKey('codeBlockVSCodePaste'),
    props: {
      handlePaste(view, event) {
        const data = event.clipboardData
        if (!data) return false
        const { $from } = view.state.selection
        if ($from.parent.type === type) return false
        const text = data.getData('text/plain')
        const mode = readVSCodeMode(data.getData('vscode-editor-data'))
        if (!text || mode === undefined) return false

        const { tr, schema } = view.state
        const textNode = schema.text(text.replace(/\r\n?/g, '\n'))
        const language = normalizeCodeLanguage(mode) ?? null
        tr.replaceSelectionWith(type.create({ language }, textNode))
        if (tr.selection.$from.parent.type !== type) {
          tr.setSelection(
            TextSelection.near(
              tr.doc.resolve(Math.max(0, tr.selection.from - 2)),
            ),
          )
        }
        tr.setMeta('paste', true)
        view.dispatch(tr)
        return true
      },
    },
  })
}

function readVSCodeMode(raw: string): string | undefined {
  if (!raw) return undefined
  try {
    const mode = (JSON.parse(raw) as { mode?: unknown }).mode
    return typeof mode === 'string' ? mode : undefined
  } catch {
    return undefined
  }
}

export const CodeBlockEditor = CodeBlock.extend({
  // Above StarterKit's Enter (split block), so a fence line can become a block.
  priority: 1000,

  addAttributes() {
    return {
      language: {
        default: null,
        // Not rendered as an attribute: the `language-x` class carries it.
        rendered: false,
        parseHTML: (element: HTMLElement) => {
          const className = [
            ...(element.firstElementChild?.classList ?? []),
          ].find((name) => name.startsWith('language-'))
          return (
            normalizeCodeLanguage(className?.slice('language-'.length)) ?? null
          )
        },
      },
    }
  },

  addNodeView() {
    return ReactNodeViewRenderer(CodeBlockView)
  },

  addInputRules() {
    return [
      // ```ts + space at the start of a line, or ~~~ts.
      textblockTypeInputRule({
        find: /^(?:```|~~~)([A-Za-z0-9_+#.-]*)\s$/,
        type: this.type,
        getAttributes: (match) => ({
          language: normalizeCodeLanguage(match[1]) ?? null,
        }),
      }),
    ]
  },

  addKeyboardShortcuts() {
    const type = this.type
    const parent = this.parent?.() ?? {}
    return {
      ...parent,
      Enter: (props) =>
        fenceParagraphToCodeBlock(props.editor, type) || parent.Enter(props),
      Tab: ({ editor }) => indentInCode(editor, type, false),
      'Shift-Tab': ({ editor }) => indentInCode(editor, type, true),
    }
  },

  addProseMirrorPlugins() {
    return [codeHighlightPlugin(), vscodePastePlugin(this.type)]
  },
})

/**
 * The editor's extension list: the shared server list with `codeBlock` swapped
 * for the editor version. The node name and schema stay the same.
 */
export function editorExtensions(base: Extensions): Extensions {
  return base.map((extension) =>
    extension === CodeBlock ? CodeBlockEditor : extension,
  )
}
