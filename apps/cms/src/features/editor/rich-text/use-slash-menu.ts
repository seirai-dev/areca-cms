import * as React from 'react'
import type { Editor } from '@tiptap/react'

/** The open slash menu: what follows the `/`, its range, and where to show it. */
export type SlashState = {
  query: string
  from: number
  to: number
  left: number
  top: number
}

type SlashCommand = {
  label: () => string
  keywords: string
  run: (editor: Editor) => void
}

/** Keeps a command whose label or keywords contain the query. */
export function slashMatches<TCommand extends SlashCommand>(
  commands: TCommand[],
  query: string,
): TCommand[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return commands
  return commands.filter(
    (command) =>
      command.label().toLowerCase().includes(needle) ||
      command.keywords.includes(needle),
  )
}

function sameSlash(a: SlashState, b: SlashState) {
  return (
    a.query === b.query &&
    a.from === b.from &&
    a.to === b.to &&
    a.left === b.left &&
    a.top === b.top
  )
}

/**
 * The slash menu: `/query` typed at the start of an empty paragraph opens it,
 * arrows move, Enter or Tab runs, Escape closes. The editor is created with
 * `keyRef` as its key handler (before this hook can see it), so the hook
 * points `keyRef` at its own handler.
 */
export function useSlashMenu<TCommand extends SlashCommand>(
  editor: Editor | null,
  commands: TCommand[],
  keyRef: React.RefObject<(event: KeyboardEvent) => boolean>,
) {
  const [slash, setSlash] = React.useState<SlashState | null>(null)
  const [index, setIndex] = React.useState(0)
  const queryRef = React.useRef<string | null>(null)
  // What the transaction listener last applied. Every transaction runs it,
  // so a no-op must not reach setState: a nested update from a commit is what
  // trips React's "Maximum update depth exceeded".
  const appliedRef = React.useRef<SlashState | null>(null)

  React.useEffect(() => {
    if (!editor) return
    const apply = (next: SlashState | null) => {
      const current = appliedRef.current
      if (next === null && current === null) return
      if (next && current && sameSlash(current, next)) return
      appliedRef.current = next
      setSlash(next)
    }
    const update = () => {
      const { $from, empty } = editor.state.selection
      if (
        !empty ||
        !editor.isFocused ||
        $from.parent.type.name !== 'paragraph'
      ) {
        queryRef.current = null
        apply(null)
        return
      }
      const text = $from.parent.textBetween(
        0,
        $from.parentOffset,
        undefined,
        '￼',
      )
      const match = /^\/([\p{L}\d ]{0,24})$/u.exec(text)
      if (!match) {
        queryRef.current = null
        apply(null)
        return
      }
      const coords = editor.view.coordsAtPos($from.pos)
      if (queryRef.current !== match[1]) setIndex(0)
      queryRef.current = match[1]
      // Option updates also fire transactions: `apply` skips an unchanged menu.
      apply({
        query: match[1],
        from: $from.start(),
        to: $from.pos,
        left: coords.left,
        top: coords.bottom,
      })
    }
    const hide = () => apply(null)
    editor.on('transaction', update)
    editor.on('blur', hide)
    return () => {
      editor.off('transaction', update)
      editor.off('blur', hide)
    }
  }, [editor])

  const matches = React.useMemo(
    () => (slash ? slashMatches(commands, slash.query) : []),
    [slash, commands],
  )

  const close = () => {
    appliedRef.current = null
    setSlash(null)
  }

  const run = (command: TCommand) => {
    if (!editor || !slash) return
    editor.chain().focus().deleteRange({ from: slash.from, to: slash.to }).run()
    close()
    command.run(editor)
  }

  const active = Math.min(index, matches.length - 1)

  keyRef.current = (event) => {
    if (!slash || matches.length === 0) return false
    if (event.key === 'ArrowDown') {
      setIndex((current) => (current + 1) % matches.length)
      return true
    }
    if (event.key === 'ArrowUp') {
      setIndex((current) => (current - 1 + matches.length) % matches.length)
      return true
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      run(matches[active])
      return true
    }
    if (event.key === 'Escape') {
      close()
      return true
    }
    return false
  }

  /** Null while closed or when nothing matches. */
  const open = slash && matches.length > 0 ? slash : null
  return { slash: open, matches, active, setActive: setIndex, run }
}
