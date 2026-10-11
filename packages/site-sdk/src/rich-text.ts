import { parseMarkdown } from '@tanstack/markdown/parser'
import type { MarkdownDocument } from '@tanstack/markdown'
import type { RichTextValue } from './types.js'

const EMPTY_DOCUMENT: MarkdownDocument = { type: 'root', children: [] }

/**
 * Pre-parsed TanStack Markdown document, ready for `<Markdown>` or `renderHtml`.
 *
 * Snapshots published before the CMS shipped `document` only carry
 * `markdown`; those are parsed here so older publications keep rendering.
 */
export function richTextDocument(
  value: RichTextValue | null | undefined,
): MarkdownDocument {
  if (!value) return EMPTY_DOCUMENT
  if (value.document) return value.document
  if (typeof value.markdown === 'string' && value.markdown.length > 0) {
    return parseMarkdown(value.markdown, { frontmatter: false })
  }
  return EMPTY_DOCUMENT
}

/** Escaped Markdown export; the document preserves editor-only structures and sizing. */
export function richTextMarkdown(
  value: RichTextValue | null | undefined,
): string {
  return value?.markdown ?? ''
}

/** Static HTML fallback. Prefer `richTextDocument` with a TanStack renderer. */
export function richTextHtml(value: RichTextValue | null | undefined): string {
  return value?.html ?? ''
}
