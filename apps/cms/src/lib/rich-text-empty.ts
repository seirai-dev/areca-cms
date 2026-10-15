/**
 * True when a rich-text value holds no text. Pure, so it runs on the client
 * and on the server. Empty means null, '', or a doc whose blocks are all
 * empty paragraphs.
 */
export function isEmptyRichText(value: unknown): boolean {
  if (value == null || value === '') return true
  if (typeof value !== 'object' || Array.isArray(value)) return false
  const doc = value as { type?: string; content?: unknown[] }
  if (doc.type !== 'doc') return false
  const content = doc.content ?? []
  if (!Array.isArray(content)) return false
  if (content.length === 0) return true
  return content.every((node) => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return false
    const item = node as { type?: string; content?: unknown[] }
    return (
      item.type === 'paragraph' &&
      (item.content === undefined ||
        (Array.isArray(item.content) && item.content.length === 0))
    )
  })
}
