/**
 * Shared syntax highlighter for rich text code blocks. Isomorphic: used by the
 * server (published html) and, in PR 2, by the editor's highlight decorations.
 *
 * Only the languages listed in CODE_LANGUAGES are imported on purpose. The
 * package root bundles every grammar; importing it here would bloat the editor.
 */
import { createHighlighter } from '@tanstack/highlight/core'
import { css } from '@tanstack/highlight/languages/css'
import { diff } from '@tanstack/highlight/languages/diff'
import { go } from '@tanstack/highlight/languages/go'
import { html } from '@tanstack/highlight/languages/html'
import { js } from '@tanstack/highlight/languages/js'
import { json } from '@tanstack/highlight/languages/json'
import { jsx } from '@tanstack/highlight/languages/jsx'
import { markdown } from '@tanstack/highlight/languages/markdown'
import { php } from '@tanstack/highlight/languages/php'
import { plaintext } from '@tanstack/highlight/languages/plaintext'
import { python } from '@tanstack/highlight/languages/python'
import { rust } from '@tanstack/highlight/languages/rust'
import { shell } from '@tanstack/highlight/languages/shell'
import { sql } from '@tanstack/highlight/languages/sql'
import { ts } from '@tanstack/highlight/languages/ts'
import { tsx } from '@tanstack/highlight/languages/tsx'
import { yaml } from '@tanstack/highlight/languages/yaml'

export type CodeLanguage = { id: string; label: string }

/** Languages offered in the editor, in picker order. `plaintext` means no language. */
export const CODE_LANGUAGES: ReadonlyArray<CodeLanguage> = [
  { id: 'plaintext', label: 'Plain text' },
  { id: 'ts', label: 'TypeScript' },
  { id: 'tsx', label: 'TSX' },
  { id: 'js', label: 'JavaScript' },
  { id: 'jsx', label: 'JSX' },
  { id: 'html', label: 'HTML' },
  { id: 'css', label: 'CSS' },
  { id: 'json', label: 'JSON' },
  { id: 'shell', label: 'Shell' },
  { id: 'python', label: 'Python' },
  { id: 'php', label: 'PHP' },
  { id: 'sql', label: 'SQL' },
  { id: 'yaml', label: 'YAML' },
  { id: 'markdown', label: 'Markdown' },
  { id: 'go', label: 'Go' },
  { id: 'rust', label: 'Rust' },
  { id: 'diff', label: 'Diff' },
]

export const codeHighlighter = createHighlighter({
  languages: [
    plaintext,
    ts,
    tsx,
    js,
    jsx,
    html,
    css,
    json,
    shell,
    python,
    php,
    sql,
    yaml,
    markdown,
    go,
    rust,
    diff,
  ],
})

const SUPPORTED = new Set(CODE_LANGUAGES.map((language) => language.id))

/** Common names people write in fences, mapped to a supported id. */
const ALIASES = new Map<string, string>([
  ['bash', 'shell'],
  ['sh', 'shell'],
  ['zsh', 'shell'],
  ['shell-session', 'shell'],
  ['typescript', 'ts'],
  ['javascript', 'js'],
  ['node', 'js'],
  ['yml', 'yaml'],
  ['py', 'python'],
  ['md', 'markdown'],
  ['htm', 'html'],
  ['patch', 'diff'],
  ['golang', 'go'],
  ['rs', 'rust'],
  ['text', 'plaintext'],
  ['txt', 'plaintext'],
  ['plain', 'plaintext'],
])

/**
 * Maps a raw language (from a fence, paste or agent input) to a supported id.
 * Returns `undefined` for empty input and plain text, the trimmed input when
 * the language is unknown (kept verbatim, shown without colours).
 */
export function normalizeCodeLanguage(
  raw: string | null | undefined,
): string | undefined {
  const trimmed = raw?.trim() ?? ''
  if (trimmed.length === 0) return undefined
  const lower = trimmed.toLowerCase()
  const id = SUPPORTED.has(lower) ? lower : ALIASES.get(lower)
  if (id === undefined) return trimmed
  return id === 'plaintext' ? undefined : id
}

/** True when `id` is one of the supported ids (not an alias, not unknown). */
export function isSupportedCodeLanguage(id: string): boolean {
  return SUPPORTED.has(id)
}
