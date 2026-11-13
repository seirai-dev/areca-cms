/**
 * Shared syntax highlighter for rich text code blocks, with every grammar of
 * CODE_LANGUAGES: the published html and the editor's Preview mode. The
 * editor's code blocks load one grammar at a time (`code-grammars.ts`).
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

export {
  CODE_LANGUAGES,
  isSupportedCodeLanguage,
  normalizeCodeLanguage,
} from './code-languages'
export type { CodeLanguage } from './code-languages'

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
