type TextNode = {
  type: string
  attrs?: Record<string, unknown>
  content?: TextNode[]
  text?: string
}

const BLOCK_JOIN = new Set([
  'doc',
  'blockquote',
  'bulletList',
  'orderedList',
  'listItem',
  'table',
  'tableRow',
])

function extractPlain(node: TextNode): string {
  if (node.type === 'text') return node.text ?? ''
  if (node.type === 'hardBreak') return '\n'
  if (node.type === 'image')
    return typeof node.attrs?.alt === 'string' ? node.attrs.alt : ''
  if (node.type === 'horizontalRule') return ''
  // Code blocks are not prose; they would fill descriptions with source code.
  if (node.type === 'codeBlock') return ''
  const parts = (node.content ?? []).map(extractPlain)
  if (BLOCK_JOIN.has(node.type)) {
    return parts.filter((part) => part.length > 0).join('\n')
  }
  return parts.join('')
}

/**
 * The plain text of a TipTap document: blocks on their own lines, image alt
 * text kept, code blocks left out. The server's fallback description and the
 * editor's search preview both read it, so the preview shows what is published.
 */
export function richTextPlainText(json: unknown): string {
  if (typeof json !== 'object' || json === null) return ''
  return extractPlain(json as TextNode).trim()
}
