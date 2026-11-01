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
  'table',
  'tableRow',
  'tableHeader',
  'tableCell',
])

export const ALLOWED_MARK_TYPES = new Set(['bold', 'italic', 'link', 'code'])

export function isAllowedLinkHref(href: string): boolean {
  try {
    const url = new URL(href)
    if (url.protocol === 'mailto:') {
      return url.pathname.length > 0
    }
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return url.hostname.length > 0
    }
    return false
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
