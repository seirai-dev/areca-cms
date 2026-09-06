export const ALLOWED_NODE_TYPES = new Set([
  'doc',
  'paragraph',
  'text',
  'heading',
  'bulletList',
  'orderedList',
  'listItem',
  'blockquote',
  'codeBlock',
  'image',
  'hardBreak',
  'horizontalRule',
])

export const ALLOWED_MARK_TYPES = new Set(['bold', 'italic', 'link'])

export function isAllowedLinkHref(href: string): boolean {
  try {
    const url = new URL(href)
    return url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'mailto:'
  } catch {
    return false
  }
}

export function isAllowedImageSrc(src: string): boolean {
  if (/^\/(api\/)?assets\/\S+$/.test(src)) return true
  try {
    const url = new URL(src)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

export function isDisallowedAttrKey(key: string): boolean {
  const lower = key.toLowerCase()
  return lower === 'style' || lower.startsWith('on')
}
