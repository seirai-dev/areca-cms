/**
 * The code block languages, without any grammar. The editor's language picker
 * and the fence parser need only this; the grammars live in `highlight.ts`
 * (server) and load on demand in the editor (`code-grammars.ts`).
 */

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
