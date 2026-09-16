import type { JSONContent } from '@tiptap/core'
import type { MarkdownDocument } from '@tanstack/markdown'

import { env } from '#/env'

import { parseRichTextDocument, renderRichTextHtml } from './document'
import { serializeMarkdown } from './markdown'
import { validateRichText } from './validate'

const RELATIVE_ASSET_SRC = /^\/(api\/)?assets\//

export { parseRichTextDocument, renderRichTextHtml } from './document'
export { richTextExtensions } from './extensions'
export { richTextPlainText } from './markdown'
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

function imageDimensions(node: JSONContent): Array<{
  width?: number
  height?: number
}> {
  const dimensions: Array<{ width?: number; height?: number }> = []
  function visit(current: JSONContent) {
    if (current.type === 'image') {
      const width = current.attrs?.width
      const height = current.attrs?.height
      dimensions.push({
        ...(typeof width === 'number' && { width }),
        ...(typeof height === 'number' && { height }),
      })
    }
    current.content?.forEach(visit)
  }
  visit(node)
  return dimensions
}

function addImageDimensionsToHtml(html: string, json: JSONContent): string {
  const dimensions = imageDimensions(json)
  let index = 0
  return html.replace(/<img\b/g, (tag) => {
    const size = dimensions.at(index++)
    if (!size) return tag
    const attrs = [
      size.width ? ` width="${size.width}"` : '',
      size.height ? ` height="${size.height}"` : '',
    ].join('')
    return `${tag}${attrs}`
  })
}

/**
 * Build the published shape of a rich text field. Markdown is the canonical
 * serialization; `document` is the TanStack Markdown AST parsed from it and
 * `html` is TanStack's static rendering of that same AST.
 */
export function convertRichText(json: unknown): {
  json: unknown
  markdown: string
  document: MarkdownDocument
  html: string
} {
  const errors = validateRichText(json)
  if (errors.length > 0) {
    throw new Error(errors.join('\n'))
  }

  const rewritten = structuredClone(json) as JSONContent
  rewriteRelativeAssetSrcs(rewritten)

  const markdown = serializeMarkdown(rewritten)
  const document = parseRichTextDocument(markdown)
  const html = addImageDimensionsToHtml(renderRichTextHtml(document), rewritten)

  return {
    json: rewritten,
    markdown,
    document,
    html,
  }
}
