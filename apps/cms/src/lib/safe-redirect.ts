const SAME_ORIGIN_BASE = 'https://redirect.invalid'

// Same rules as Better Auth's isSafeRelativeURL: browsers and URL parsers
// treat `\`, tabs and newlines like `/`, so `/\evil.example` leaves the site.
export function safeRedirectPath(value: unknown): string {
  if (typeof value !== 'string') {
    return '/'
  }

  if (!value.startsWith('/') || value.startsWith('//')) {
    return '/'
  }

  // eslint-disable-next-line no-control-regex
  if (/[\\\x00-\x20\x7f]/.test(value)) {
    return '/'
  }

  const path = value.split(/[?#]/, 1)[0] ?? ''
  if (/%(2f|5c)/i.test(path)) {
    return '/'
  }

  try {
    if (new URL(value, SAME_ORIGIN_BASE).origin !== SAME_ORIGIN_BASE) {
      return '/'
    }
  } catch {
    return '/'
  }

  return value
}
