/**
 * Pure text helpers for code blocks in the rich text editor. No Tiptap or React
 * imports, so the Tab, Shift+Tab and fence rules can be unit-tested directly.
 *
 * Offsets are character offsets into the code block's text (the block's
 * `textContent`), where a line break is a literal `\n`.
 */

export const CODE_INDENT = '  '

export type CodeTextEdit = {
  /** Range of the original text that is replaced. */
  from: number
  to: number
  /** Replacement text. */
  text: string
  /** Selection after the edit, in the new text's offsets. */
  selectionFrom: number
  selectionTo: number
}

function lineStart(code: string, offset: number): number {
  return code.lastIndexOf('\n', offset - 1) + 1
}

function lineEnd(code: string, offset: number): number {
  const end = code.indexOf('\n', offset)
  return end === -1 ? code.length : end
}

/**
 * The lines a selection touches. A selection that ends at column 0 of a later
 * line does not include that line, as in most code editors.
 */
function selectedLines(code: string, from: number, to: number) {
  const effectiveTo = to > from && code[to - 1] === '\n' ? to - 1 : to
  const start = lineStart(code, from)
  const end = lineEnd(code, Math.max(effectiveTo, from))
  return { start, end }
}

/**
 * Tab. A cursor gets two spaces at its position. A selection indents every
 * line it touches. Returns null when there is nothing to change.
 */
export function indentCode(
  code: string,
  from: number,
  to: number,
): CodeTextEdit | null {
  if (from === to) {
    return {
      from,
      to,
      text: CODE_INDENT,
      selectionFrom: from + CODE_INDENT.length,
      selectionTo: from + CODE_INDENT.length,
    }
  }
  const { start, end } = selectedLines(code, from, to)
  const block = code.slice(start, end)
  const text = block
    .split('\n')
    .map((line) => CODE_INDENT + line)
    .join('\n')
  return {
    from: start,
    to: end,
    text,
    selectionFrom: start,
    selectionTo: start + text.length,
  }
}

/** Leading spaces on a line that Shift+Tab may remove, up to `size`. */
function removable(line: string, size: number): number {
  const leading = /^ */.exec(line)?.[0].length ?? 0
  return Math.min(leading, size)
}

/**
 * Shift+Tab. Removes up to `size` leading spaces from each line the selection
 * touches (only the cursor's line for a cursor). Returns null when no line has
 * leading spaces to remove.
 */
export function outdentCode(
  code: string,
  from: number,
  to: number,
  size = CODE_INDENT.length,
): CodeTextEdit | null {
  const { start, end } = selectedLines(code, from, to)
  const lines = code.slice(start, end).split('\n')
  const removed = lines.map((line) => removable(line, size))
  if (removed.every((count) => count === 0)) return null

  const text = lines.map((line, index) => line.slice(removed[index])).join('\n')

  if (from === to) {
    // Keep the cursor on the same character, clamped to the line start.
    const cursorLineStart = lineStart(code, from)
    const cursor = Math.max(cursorLineStart, from - removed[0])
    return {
      from: start,
      to: end,
      text,
      selectionFrom: cursor,
      selectionTo: cursor,
    }
  }
  return {
    from: start,
    to: end,
    text,
    selectionFrom: start,
    selectionTo: start + text.length,
  }
}

/**
 * A line that opens a fence: ```` ```ts ```` or `~~~ts`, with the language
 * optional (spaces after the fence are allowed, as in Markdown). Returns the raw language (may be empty), or null when the text is
 * not a fence opener.
 */
export function fenceOpenerLanguage(text: string): string | null {
  const match = /^(?:```|~~~)\s*([A-Za-z0-9_+#.-]*)$/.exec(text.trim())
  return match ? match[1] : null
}
