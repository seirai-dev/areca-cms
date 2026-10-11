/** Fixed zone so prerendered dates do not depend on the build machine. */
const TIME_ZONE = 'Europe/Oslo'

export function formatDate(value: string | null | undefined): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: TIME_ZONE,
  }).format(date)
}

/** EUR with two decimals, e.g. 18.5 -> "€18.50". */
export function formatPrice(value: number | null | undefined): string | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

/** Metres above sea level, e.g. 1950 -> "1,950 masl". */
export function formatAltitude(value: number | null | undefined): string | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null
  return `${new Intl.NumberFormat('en-GB').format(value)} masl`
}

/** Option keys such as "medium-dark" or "origin-stories" as sentence-case labels. */
export function formatLabel(value: string | null | undefined): string | null {
  if (!value) return null
  const text = value.replace(/-/g, ' ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/**
 * Splits the comma-separated tasting notes field into trimmed, non-empty notes.
 * Kept here (not imported from lib/content.ts) so client components never pull
 * the Node-only content reader into the browser bundle.
 */
export function splitTastingNotes(value: string | null | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((note) => note.trim())
    .filter(Boolean)
}
