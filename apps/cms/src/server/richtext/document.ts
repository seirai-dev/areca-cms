import { renderHtml } from '@tanstack/markdown/html'
import { parseMarkdown } from '@tanstack/markdown/parser'
import type { MarkdownDocument } from '@tanstack/markdown'

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

/** Static HTML fallback for sites that do not render the document themselves. */
export function renderRichTextHtml(document: MarkdownDocument): string {
  return renderHtml(document)
}
