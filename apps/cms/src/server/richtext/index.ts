import type { JSONContent } from '@tiptap/core'
import type { MarkdownDocument } from '@tanstack/markdown'

import { env } from '#/env'
import { ValidationError } from '#/server/content/errors'

import { renderRichTextHtml } from './document'
import { serializeMarkdownWithEntryLinks } from './markdown'
import { richTextDocumentFromJson } from './from-json'
import type { EntryLinkMarker } from './markdown'
import { validateRichText } from './validate'

const RELATIVE_ASSET_SRC = /^\/(api\/)?assets\//

export { parseRichTextDocument, renderRichTextHtml } from './document'
export { richTextExtensions } from './extensions'
export {
  entryLinkTargets,
  resolveEntryLinks,
  richTextHeadingIds,
} from './entry-links'
export type {
  EntryLinkIssue,
  EntryLinkResolution,
  EntryLinkTarget,
} from './entry-links'
export { richTextPlainText } from '#/lib/richtext-text'
export {
  markdownToRichText,
  normalizeRichTextInput,
  richTextToMarkdown,
} from './from-markdown'
export type { MarkdownToRichTextOptions, RichTextDoc } from './from-markdown'
export { validateRichText } from './validate'

export function emptyRichText() {
  return { type: 'doc' as const, content: [{ type: 'paragraph' as const }] }
}

function appOrigin(): string {
  return env.APP_URL.replace(/\/+$/, '')
}

function rewriteRelativeAssetSrcs(node: JSONContent): void {
  if (
    node.type === 'image' &&
    node.attrs &&
    typeof node.attrs.src === 'string'
  ) {
    const src = node.attrs.src
    if (RELATIVE_ASSET_SRC.test(src)) {
      node.attrs.src = `${appOrigin()}${src}`
    }
  }
  if (!Array.isArray(node.content)) return
  for (const child of node.content) {
    rewriteRelativeAssetSrcs(child)
  }
}

/**
 * Build the published shape of a rich text field. Markdown is the canonical
 * export; `document` preserves the validated editor structure directly and
 * `html` is TanStack's static rendering of that same AST.
 */
export function convertRichText(json: unknown): {
  json: unknown
  markdown: string
  document: MarkdownDocument
  html: string
  /** One marker per entry link in `markdown`, when the text has any. */
  entryLinks?: EntryLinkMarker[]
} {
  const errors = validateRichText(json)
  if (errors.length > 0) {
    throw new ValidationError(
      errors.map((message) => ({ path: 'richtext', message })),
    )
  }

  const rewritten = structuredClone(json) as JSONContent
  rewriteRelativeAssetSrcs(rewritten)

  const { markdown, entryLinks } = serializeMarkdownWithEntryLinks(rewritten)
  const document = richTextDocumentFromJson(rewritten)
  const html = renderRichTextHtml(document)

  return {
    json: rewritten,
    markdown,
    document,
    html,
    ...(entryLinks.length > 0 ? { entryLinks } : {}),
  }
}
