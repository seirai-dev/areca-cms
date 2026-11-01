import { createTanStackMarkdownHighlighter } from '@tanstack/highlight/markdown'
import { renderHtml } from '@tanstack/markdown/html'
import { parseMarkdown } from '@tanstack/markdown/parser'
import type { MarkdownDocument } from '@tanstack/markdown'

import { codeHighlighter } from '#/lib/highlight'

const highlightCode = createTanStackMarkdownHighlighter(codeHighlighter)

/**
 * Parse serialized rich text markdown into a TanStack Markdown document.
 *
 * The AST is what sites receive in the snapshot, so parsing runs here with a
 * fixed option set. Frontmatter is off because editor content never carries
 * it, and a leading `---` (a divider) must stay a thematic break.
 */
export function parseRichTextDocument(markdown: string): MarkdownDocument {
  return parseMarkdown(markdown, { frontmatter: false })
}

/**
 * Static HTML fallback for sites that do not render the document themselves.
 * Code blocks get `token …` classes only; colours are left to the site's CSS.
 */
export function renderRichTextHtml(document: MarkdownDocument): string {
  return renderHtml(document, { highlighter: highlightCode }).replace(
    /<\/img>/g,
    '',
  )
}
