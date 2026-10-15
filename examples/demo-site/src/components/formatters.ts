import { m } from '#/paraglide/messages'
import { getLocale } from '#/paraglide/runtime'

/** Fixed zone so prerendered dates do not depend on the build machine. */
const TIME_ZONE = 'Europe/Oslo'

/** BCP 47 tag for `Intl` formatting in the active language. */
function intlTag(): string {
  return getLocale() === 'nl' ? 'nl-NL' : 'en-GB'
}

export function formatDate(value: string | null | undefined): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat(intlTag(), {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: TIME_ZONE,
  }).format(date)
}

/** EUR with two decimals, e.g. 18.5 -> "€18.50". */
export function formatPrice(value: number | null | undefined): string | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null
  return new Intl.NumberFormat(intlTag(), {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

/** Metres above sea level, e.g. 1950 -> "1,950 masl". */
export function formatAltitude(value: number | null | undefined): string | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null
  return m.altitude_masl({ value: new Intl.NumberFormat(intlTag()).format(value) })
}

/** Roast steps in order, light to dark. */
export const ROAST_STEPS = ['light', 'medium', 'medium-dark', 'dark'] as const

/** Translated label of a roast-level option key, or null when unset. */
export function roastLabel(value: string | null | undefined): string | null {
  switch (value) {
    case 'light':
      return m.roast_light()
    case 'medium':
      return m.roast_medium()
    case 'medium-dark':
      return m.roast_medium_dark()
    case 'dark':
      return m.roast_dark()
    default:
      return humanize(value)
  }
}

/** Translated label of a processing-method option key, or null when unset. */
export function processLabel(value: string | null | undefined): string | null {
  switch (value) {
    case 'washed':
      return m.process_washed()
    case 'natural':
      return m.process_natural()
    case 'honey':
      return m.process_honey()
    case 'anaerobic':
      return m.process_anaerobic()
    default:
      return humanize(value)
  }
}

/** Translated label of an article category option key, or null when unset. */
export function categoryLabel(value: string | null | undefined): string | null {
  switch (value) {
    case 'origin-stories':
      return m.category_origin_stories()
    case 'brewing':
      return m.category_brewing()
    case 'roastery-news':
      return m.category_roastery_news()
    case 'sustainability':
      return m.category_sustainability()
    default:
      return humanize(value)
  }
}

/** Fallback for an option key the site has no translation for: sentence case. */
function humanize(value: string | null | undefined): string | null {
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
