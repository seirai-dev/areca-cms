const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/

/**
 * Builds the `From` header. `SMTP_FROM` may be a bare address or already
 * carry a display name; a branded name replaces any existing one.
 */
export function formatFrom(from: string, fromName?: string | null) {
  const name = fromName?.trim().replace(/["\r\n<>]/g, '')
  if (!name) return from
  const match = from.match(/<([^>]+)>/)
  const address = (match ? match[1] : from).trim()
  return `"${name}" <${address}>`
}

/** A bare address, or `Name <address>` with an optional quoted name. */
export function isMailAddress(value: string) {
  const trimmed = value.trim()
  const angled = trimmed.match(/^[^<>]*<([^<>]+)>$/)
  return EMAIL.test((angled ? angled[1] : trimmed).trim())
}
