import type { JSONContent } from '@tiptap/core'
import { generateHTML } from '@tiptap/html'

import { richTextExtensions } from './extensions'
import { serializeMarkdown } from './markdown'
import { validateRichText } from './validate'

export { richTextExtensions } from './extensions'
export { richTextPlainText } from './markdown'
export { validateRichText } from './validate'

export function emptyRichText() {
  return { type: 'doc' as const, content: [{ type: 'paragraph' as const }] }
}

export function convertRichText(json: unknown): {
  json: unknown
  html: string
  markdown: string
} {
  const errors = validateRichText(json)
  if (errors.length > 0) {
    throw new Error(errors.join('\n'))
  }

  return {
    json,
    html: generateHTML(json as JSONContent, richTextExtensions),
    markdown: serializeMarkdown(json),
  }
}
