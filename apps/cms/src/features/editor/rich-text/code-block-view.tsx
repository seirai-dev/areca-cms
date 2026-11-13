import * as React from 'react'
import { NodeViewContent, NodeViewWrapper } from '@tiptap/react'
import type { Editor, NodeViewProps } from '@tiptap/react'
import { Check, CaretUpDown } from '@phosphor-icons/react'

import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from '#/components/ui/command'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '#/components/ui/popover'
import { isSupportedCodeLanguage, CODE_LANGUAGES } from '#/lib/code-languages'
import { m } from '#/paraglide/messages'

/** The stored value for "no language". Plain text is stored as null. */
const PLAIN_TEXT = 'plaintext'

function languageLabel(language: string | null): string {
  if (!language || language === PLAIN_TEXT)
    return m.editor_code_language_plain()
  const known = CODE_LANGUAGES.find((item) => item.id === language)
  // Unknown languages are shown as typed; nothing is rewritten on load.
  return known ? known.label : language
}

/**
 * Returns focus to the code. Does nothing when the caret is already inside
 * this block (the popover can report its close more than once), otherwise
 * puts the caret back at `caret`, or at the end of the code.
 */
function focusCode(
  editor: Editor,
  getPos: () => number | undefined,
  caret: number | null,
) {
  const pos = getPos()
  if (typeof pos !== 'number') return
  const node = editor.state.doc.nodeAt(pos)
  if (!node) return
  const start = pos + 1
  const end = pos + node.nodeSize - 1
  const { from, to } = editor.state.selection
  if (editor.isFocused && from >= start && to <= end) return
  const target = caret !== null && caret >= start && caret <= end ? caret : end
  editor.chain().focus().setTextSelection(target).run()
}

/**
 * A code block with a language button in its top-right corner. The button is
 * outside the text (contentEditable=false) and the text is the `code` child.
 */
export function CodeBlockView({
  node,
  editor,
  getPos,
  updateAttributes,
}: NodeViewProps) {
  const language = (node.attrs.language as string | null | undefined) ?? null
  const [open, setOpen] = React.useState(false)
  // Where the caret was when the picker opened, so focus returns there.
  const caretRef = React.useRef<number | null>(null)
  const openChange = (next: boolean) => {
    if (next) caretRef.current = editor.state.selection.from
    setOpen(next)
  }
  const known = language === null || isSupportedCodeLanguage(language)
  const label = languageLabel(language)

  const choose = (id: string) => {
    updateAttributes({ language: id === PLAIN_TEXT ? null : id })
    setOpen(false)
    // The popover's focus scope lets go after this tick; focus the code then.
    window.setTimeout(() => focusCode(editor, getPos, caretRef.current), 0)
  }

  return (
    <NodeViewWrapper
      as="pre"
      className="code-block"
      data-testid="rich-text-code-block"
      data-language={language ?? ''}
    >
      <Popover open={open} onOpenChange={openChange}>
        <PopoverTrigger asChild>
          <button
            type="button"
            contentEditable={false}
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-label={`${m.editor_code_language()}: ${label}`}
            className="code-block-language"
            data-testid="rich-text-code-language"
          >
            <span className="truncate">{label}</span>
            <CaretUpDown weight="bold" aria-hidden="true" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          className="w-64 p-0"
          data-testid="rich-text-code-language-menu"
          onCloseAutoFocus={(event) => {
            // Esc or a pick returns focus to the code, not the trigger.
            event.preventDefault()
            focusCode(editor, getPos, caretRef.current)
          }}
        >
          <Command loop>
            <CommandInput
              placeholder={m.editor_code_language_search()}
              aria-label={m.editor_code_language_search()}
              size="md"
            />
            <CommandList>
              <CommandEmpty>{m.editor_code_language_no_results()}</CommandEmpty>
              {language !== null && !known ? (
                <p
                  className="px-2.5 pt-1.5 pb-1 text-caption text-text-muted"
                  data-testid="rich-text-code-language-unknown"
                >
                  {m.editor_code_language_unknown({ language })}
                </p>
              ) : null}
              {CODE_LANGUAGES.map((item) => {
                const selected =
                  item.id === PLAIN_TEXT
                    ? language === null
                    : language === item.id
                return (
                  <CommandItem
                    key={item.id}
                    value={`${item.label} ${item.id}`}
                    onSelect={() => choose(item.id)}
                    data-testid={`rich-text-code-language-${item.id}`}
                    data-selected={selected ? 'true' : undefined}
                  >
                    <span className="flex-1 truncate">
                      {item.id === PLAIN_TEXT
                        ? m.editor_code_language_plain()
                        : item.label}
                    </span>
                    {selected ? (
                      <Check
                        weight="bold"
                        className="size-3.5 text-icon-accent"
                      />
                    ) : null}
                  </CommandItem>
                )
              })}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      <NodeViewContent<'code'> as="code" />
    </NodeViewWrapper>
  )
}
