import { getLocale } from '#/paraglide/runtime'

function relative(value: number, unit: Intl.RelativeTimeFormatUnit) {
  return new Intl.RelativeTimeFormat(getLocale(), { numeric: 'auto' }).format(
    value,
    unit,
  )
}

/**
 * The one relative-time formatter in the app: "4m ago" for anything inside a
 * day, the full date after that. Callers always put the absolute timestamp in
 * a `title` (see `absoluteTimeLabel`), so nothing is lost.
 */
export function formatRelativeTime(value: Date | string | null | undefined) {
  if (value == null || value === '') return '—'
  const date = value instanceof Date ? value : new Date(String(value))
  const diff = date.getTime() - Date.now()
  if (Number.isNaN(diff)) return '—'
  const abs = Math.abs(diff)
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour
  if (abs < minute) return relative(0, 'second')
  if (abs < hour) return relative(Math.round(diff / minute), 'minute')
  if (abs < day) return relative(Math.round(diff / hour), 'hour')
  return new Intl.DateTimeFormat(getLocale(), { dateStyle: 'medium' }).format(
    date,
  )
}

/** Full timestamp for tooltips and `title` attributes. */
export function absoluteTimeLabel(value: Date | string | null | undefined) {
  if (value == null || value === '') return undefined
  const date = value instanceof Date ? value : new Date(String(value))
  if (Number.isNaN(date.getTime())) return undefined
  return new Intl.DateTimeFormat(getLocale(), {
    dateStyle: 'full',
    timeStyle: 'short',
  }).format(date)
}
