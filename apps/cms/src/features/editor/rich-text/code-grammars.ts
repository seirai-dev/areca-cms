import { createHighlighter } from '@tanstack/highlight/core'
import type { Highlighter, LanguageDefinition } from '@tanstack/highlight/core'
import { plaintext } from '@tanstack/highlight/languages/plaintext'

/**
 * The editor's code highlighter, one grammar at a time: a grammar downloads
 * when a code block in its language appears, so an entry without code loads
 * none. Colours match the published html (`#/lib/highlight`) once loaded.
 */

const GRAMMARS: Record<string, () => Promise<LanguageDefinition>> = {
  ts: () => import('@tanstack/highlight/languages/ts').then((m) => m.ts),
  tsx: () => import('@tanstack/highlight/languages/tsx').then((m) => m.tsx),
  js: () => import('@tanstack/highlight/languages/js').then((m) => m.js),
  jsx: () => import('@tanstack/highlight/languages/jsx').then((m) => m.jsx),
  html: () => import('@tanstack/highlight/languages/html').then((m) => m.html),
  css: () => import('@tanstack/highlight/languages/css').then((m) => m.css),
  json: () => import('@tanstack/highlight/languages/json').then((m) => m.json),
  shell: () =>
    import('@tanstack/highlight/languages/shell').then((m) => m.shell),
  python: () =>
    import('@tanstack/highlight/languages/python').then((m) => m.python),
  php: () => import('@tanstack/highlight/languages/php').then((m) => m.php),
  sql: () => import('@tanstack/highlight/languages/sql').then((m) => m.sql),
  yaml: () => import('@tanstack/highlight/languages/yaml').then((m) => m.yaml),
  markdown: () =>
    import('@tanstack/highlight/languages/markdown').then((m) => m.markdown),
  go: () => import('@tanstack/highlight/languages/go').then((m) => m.go),
  rust: () => import('@tanstack/highlight/languages/rust').then((m) => m.rust),
  diff: () => import('@tanstack/highlight/languages/diff').then((m) => m.diff),
}

/**
 * Grammars that hand embedded code to others: HTML highlights its styles and
 * scripts, PHP its HTML, and Markdown the fenced code in any language.
 */
const EMBEDS: Record<string, string[]> = {
  html: ['css', 'js', 'ts'],
  php: ['html'],
  markdown: Object.keys(GRAMMARS).filter((id) => id !== 'markdown'),
}

/** `id` and every grammar it may hand code to. */
function withEmbeds(id: string, into = new Set<string>()): Set<string> {
  if (into.has(id)) return into
  into.add(id)
  for (const embedded of EMBEDS[id] ?? []) withEmbeds(embedded, into)
  return into
}

const definitions = new Map<string, LanguageDefinition>([
  ['plaintext', plaintext],
])
const ready = new Set<string>(['plaintext'])
const loading = new Map<string, Promise<void>>()
const listeners = new Set<() => void>()
let highlighter: Highlighter = createHighlighter({ languages: [plaintext] })

/** The highlighter for `id`, or null while its grammar is not loaded. */
export function grammarHighlighter(id: string): Highlighter | null {
  return ready.has(id) ? highlighter : null
}

/** Loads the grammar of `id` (and those it embeds). Unknown ids do nothing. */
export function loadCodeGrammar(id: string): Promise<void> {
  if (ready.has(id) || !(id in GRAMMARS)) return Promise.resolve()
  const running = loading.get(id)
  if (running) return running
  const next = Promise.all(
    [...withEmbeds(id)]
      .filter((name) => !definitions.has(name))
      .map(async (name) => {
        definitions.set(name, await GRAMMARS[name]())
      }),
  ).then(() => {
    ready.add(id)
    highlighter = createHighlighter({ languages: [...definitions.values()] })
    for (const listener of listeners) listener()
  })
  loading.set(id, next)
  // A failed download can be tried again by the next code block.
  next.catch(() => loading.delete(id))
  return next
}

/** Calls `listener` after each grammar loads. Returns the unsubscribe. */
export function onCodeGrammarLoaded(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
