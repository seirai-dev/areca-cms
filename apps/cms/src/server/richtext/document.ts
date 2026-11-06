import { createTanStackMarkdownHighlighter } from '@tanstack/highlight/markdown'
import { renderHtml } from '@tanstack/markdown/html'
import { parseMarkdown } from '@tanstack/markdown/parser'
import type { MarkdownDocument, MarkdownExtension } from '@tanstack/markdown'

import { codeHighlighter } from '#/lib/highlight'

import { isExternalHref } from './allowlist'

const highlightCode = createTanStackMarkdownHighlighter(codeHighlighter)

const ATTRIBUTE_ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
  '`': '&#96;',
}

function escapeAttribute(value: string): string {
  return value.replace(/[&<>"'`]/g, (char) => ATTRIBUTE_ENTITIES[char] ?? char)
}

/**
 * Renders entry links with a marker, `data-areca-entry`, so the SDK can find
 * them and localize the path. The link itself is a plain same-tab link.
 */
export const entryLinkExtension: MarkdownExtension = {
  name: 'areca-entry-links',
  renderHtml(node, context) {
    const entryId = (node as { entryId?: unknown }).entryId
    if (node.type !== 'link' || typeof entryId !== 'string') return undefined
    const children = node.children
      .map((child) => context.renderInline(child))
      .join('')
    return `<a href="${escapeAttribute(node.href)}" data-areca-entry="${escapeAttribute(entryId)}">${children}</a>`
  },
}

/**
 * Renders `http(s)` links to other sites in a new tab. Site paths, anchors and
 * `mailto:` links fall through to TanStack's default output, which has no
 * target. Matches the SDK's default link component.
 */
export const externalLinkExtension: MarkdownExtension = {
  name: 'areca-external-links',
  renderHtml(node, context) {
    if (node.type !== 'link' || !isExternalHref(node.href)) return undefined
    const title = node.title ? ` title="${escapeAttribute(node.title)}"` : ''
    const children = node.children
      .map((child) => context.renderInline(child))
      .join('')
    return `<a href="${escapeAttribute(node.href)}"${title} target="_blank" rel="noopener noreferrer">${children}</a>`
  },
}

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
 * External links get `target="_blank" rel="noopener noreferrer"`; site paths,
 * anchors and `mailto:` links get no target.
 */
export function renderRichTextHtml(document: MarkdownDocument): string {
  return renderHtml(document, {
    highlighter: highlightCode,
    extensions: [entryLinkExtension, externalLinkExtension],
  }).replace(/<\/img>/g, '')
}
