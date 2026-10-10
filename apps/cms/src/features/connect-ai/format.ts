import { getLocale } from '#/paraglide/runtime'

/** "10 Oct 2026" in the viewer's locale. */
export function formatDay(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value)
  return new Intl.DateTimeFormat(getLocale(), { dateStyle: 'medium' }).format(
    date,
  )
}
