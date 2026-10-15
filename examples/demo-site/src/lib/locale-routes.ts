/**
 * Language and localized path rules, in one place. Used by the router, the
 * head helpers, the prerender list and the Vite config. Pure: no Paraglide
 * import, so it loads in the Vite config as well.
 *
 * Keep `LOCALES` in step with `project.inlang/settings.json`. The main language
 * (`BASE_LOCALE`) has no URL prefix; every other language is served under
 * `/<locale>`, e.g. `/nl/journaal/<slug>`. Paraglide adds and strips that
 * prefix (`localizeUrl` / `deLocalizeUrl`); this module translates the page
 * segment (`journal` to `journaal`) on top of it.
 */
export const BASE_LOCALE = 'en'
export const LOCALES = ['en', 'nl'] as const
export type Locale = (typeof LOCALES)[number]

/**
 * First path segment of each page family, per language. The TanStack routes
 * use the base segment (`/journal/$slug`). These match the CMS per-language
 * route patterns in `areca.config.ts`, without the locale prefix.
 */
export const SEGMENTS: Record<string, Partial<Record<Locale, string>>> = {
  journal: { nl: 'journaal' },
  coffees: { nl: 'koffie' },
  team: {},
  about: { nl: 'over' },
}

/** Applies `map` to the first segment of an absolute path: `/journal/x` has `journal`. */
function mapFirstSegment(pathname: string, map: (segment: string) => string): string {
  const parts = pathname.split('/')
  if (parts.length < 2 || parts[1] === '') return pathname
  parts[1] = map(parts[1]!)
  return parts.join('/')
}

/** A base-language path (`/journal/x`) with its page segment translated for `locale` (`/journaal/x`). */
export function toLocalePath(pathname: string, locale: Locale): string {
  if (locale === BASE_LOCALE) return pathname
  return mapFirstSegment(pathname, (segment) => SEGMENTS[segment]?.[locale] ?? segment)
}

/** The inverse of `toLocalePath`: a translated page segment back to its base-language one. */
export function toBasePath(pathname: string, locale: Locale): string {
  if (locale === BASE_LOCALE) return pathname
  return mapFirstSegment(pathname, (segment) => {
    const base = Object.keys(SEGMENTS).find((key) => SEGMENTS[key]?.[locale] === segment)
    return base ?? segment
  })
}

/**
 * Path of `path` (a base-language path such as `/journal/x`) in `locale`, in
 * the form the router's `localizeUrl` produces: the home page of a language is
 * `/nl/`, every other page has no trailing slash.
 */
export function localizedPath(path: string, locale: Locale): string {
  const translated = toLocalePath(path, locale)
  if (locale === BASE_LOCALE) return translated
  return translated === '/' ? `/${locale}/` : `/${locale}${translated}`
}

/**
 * A CMS alternate (a per-language route path without the locale prefix, e.g.
 * `/journaal/backend`) as the full path for its language. The base language
 * has no prefix.
 */
export function prefixLocale(locale: string, path: string): string {
  return locale === BASE_LOCALE ? path : `/${locale}${path}`
}
