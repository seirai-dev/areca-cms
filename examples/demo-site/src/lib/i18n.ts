import { getLocale } from '#/paraglide/runtime'
import { BASE_LOCALE, localizedPath, LOCALES, prefixLocale } from './locale-routes.ts'
import type { Locale } from './locale-routes.ts'

export { BASE_LOCALE, LOCALES, localizedPath, type Locale }

/** Language tag to full localized path (or URL) of the same page. */
export type Alternates = Partial<Record<string, string>>

/** The visitor's language for this request, from the URL. */
export function currentLocale(): Locale {
  return getLocale()
}

/** Every language's path for a page at a base-language path, e.g. `/journal` gives `/nl/journaal`. */
export function pageAlternates(path: string): Record<Locale, string> {
  return Object.fromEntries(LOCALES.map((locale) => [locale, localizedPath(path, locale)])) as Record<
    Locale,
    string
  >
}

/**
 * The CMS's `entry.alternates` (per-language route paths without the locale
 * prefix, e.g. `/journaal/backend`) as full localized paths.
 */
export function entryAlternates(alternates: Alternates | undefined): Alternates | undefined {
  if (!alternates) return undefined
  return Object.fromEntries(
    Object.entries(alternates).flatMap(([tag, path]) =>
      path === undefined ? [] : [[tag, prefixLocale(tag, path)]],
    ),
  )
}

/** `<link rel="alternate" hreflang>` for each language, plus `x-default` for the main language. */
export function hreflangLinks(
  alternates: Alternates | undefined,
): Array<{ rel: 'alternate'; hreflang: string; href: string }> {
  if (!alternates) return []
  const links = Object.entries(alternates).flatMap(([tag, href]) =>
    href === undefined ? [] : [{ rel: 'alternate' as const, hreflang: tag, href }],
  )
  const main = alternates[BASE_LOCALE]
  return main === undefined
    ? links
    : [...links, { rel: 'alternate' as const, hreflang: 'x-default', href: main }]
}

/** Origin of an absolute URL (e.g. a page's canonical URL), so relative alternates can be made absolute. */
export function originOf(url: string | null | undefined): string | undefined {
  if (!url) return undefined
  try {
    return new URL(url).origin
  } catch {
    return undefined
  }
}
