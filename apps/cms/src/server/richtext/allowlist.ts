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

/**
 * Characters that never belong in a link: every Unicode control character
 * (C0, DEL and C1), whitespace, zero-width characters, line and paragraph
 * separators, the byte-order mark and bidirectional formatting characters.
 * Browsers strip some of them and reorder others, which is how
 * `java\tscript:` tricks work.
 */
const UNSAFE_LINK_CHARACTER =
  /[\p{Cc}\s\u200B-\u200F\u202A-\u202E\u2028\u2029\u2066-\u2069\uFEFF]/u

function hasWhitespaceOrControl(value: string): boolean {
  return UNSAFE_LINK_CHARACTER.test(value)
}

/**
 * Accepts `https://host…`, `http://host…`, `mailto:…`, site paths (`/page`,
 * `/page?q=1#x`) and in-page anchors (`#section`). Everything else, including
 * protocol-relative `//host`, backslash tricks and other schemes, is rejected.
 */
export function isAllowedLinkHref(href: string): boolean {
  if (typeof href !== 'string' || href.length === 0) return false
  if (hasWhitespaceOrControl(href)) return false
  if (href.includes('\\')) return false
  if (href.startsWith('#')) return href.length > 1
  if (href.startsWith('/')) return !href.startsWith('//')
  // Absolute URLs need a host after `//`: `https:///x` would parse as host `x`.
  if (/^https?:/i.test(href) && !/^https?:\/\/[^/]/i.test(href)) return false
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

/**
 * True for links that stay on this site: site paths and in-page anchors.
 * Editors open these in the same tab; external links open in a new tab.
 */
export function isInternalHref(href: string): boolean {
  return (
    (href.startsWith('/') || href.startsWith('#')) && isAllowedLinkHref(href)
  )
}

/**
 * True for `http(s)` links to another site. These open in a new tab with
 * `rel="noopener noreferrer"`. `mailto:` links and internal links do not.
 */
export function isExternalHref(href: string): boolean {
  return /^https?:/i.test(href) && isAllowedLinkHref(href)
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

/** Entry ids are UUIDs (`crypto.randomUUID()`). Looser than a strict UUID so tests can use short ids. */
const ENTRY_ID = /^[0-9A-Za-z-]{8,64}$/
/** Collection keys follow the identifier rule (`isSafeIdentifier`). */
const COLLECTION_KEY = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/
/**
 * A section id: what `headingIds` produces for a heading (lowercase letters,
 * digits and hyphens), in a looser form so ids made by other slug rules pass.
 */
const ANCHOR_ID = /^[A-Za-z0-9][A-Za-z0-9._~:-]{0,199}$/

export function isEntryLinkId(value: unknown): value is string {
  return typeof value === 'string' && ENTRY_ID.test(value)
}

export function isEntryLinkCollection(value: unknown): value is string {
  return typeof value === 'string' && COLLECTION_KEY.test(value)
}

export function isEntryLinkAnchor(value: unknown): value is string {
  return typeof value === 'string' && ANCHOR_ID.test(value)
}

/** The mark attributes that only an entry link carries. */
export const ENTRY_LINK_ATTRS = ['entryId', 'collection', 'anchor'] as const
