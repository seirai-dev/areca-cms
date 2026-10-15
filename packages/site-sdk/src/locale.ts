import type { SiteLanguages } from './types.js'

/** Language subtag of a tag: `nl-BE` gives `nl`. */
export function languageSubtag(tag: string): string {
  return tag.split('-')[0]!.toLowerCase()
}

/** The entry of `available` equal to `tag`, ignoring case. */
function findTag(available: readonly string[], tag: string): string | undefined {
  const wanted = tag.toLowerCase()
  return available.find((candidate) => candidate.toLowerCase() === wanted)
}

/**
 * Picks the language to serve from `available` (the languages an entry has
 * complete). Order: the exact tag (case-insensitive), then the language
 * subtag, then the main language, then the first available language in site
 * order. `requested` undefined starts at the main language. `exact` is true
 * only when the requested tag itself is available. Returns undefined only when
 * nothing is available.
 */
export function chooseLocale(
  available: readonly string[],
  requested: string | undefined,
  languages: SiteLanguages | null | undefined,
): { locale: string; exact: boolean } | undefined {
  if (available.length === 0) return undefined
  if (requested !== undefined) {
    const exact = findTag(available, requested)
    if (exact !== undefined) return { locale: exact, exact: true }
    const subtag = findTag(available, languageSubtag(requested))
    if (subtag !== undefined) return { locale: subtag, exact: false }
  }
  const mainMatch = languages?.main === undefined ? undefined : findTag(available, languages.main)
  if (mainMatch !== undefined) return { locale: mainMatch, exact: false }
  for (const tag of languages?.all ?? []) {
    const inSite = findTag(available, tag)
    if (inSite !== undefined) return { locale: inSite, exact: false }
  }
  return { locale: available[0]!, exact: false }
}

/**
 * Picks the site language for a visitor. `input` is one tag, a list of tags in
 * preference order, or an `Accept-Language` header (`de;q=0.9, en;q=0.8`).
 * Each tag is tried as an exact match, then by its language subtag. When none
 * matches, the main language is returned. Undefined without languages.
 *
 * This is the function to wire into any i18n library: it is pure, so pass its
 * result as the content locale (see `createContent({ locale })`).
 *
 * Paraglide needs no call here: `areca pull` wires `getLocale` when
 * `i18n.paraglide` is set.
 */
export function matchLocale(
  input: string | readonly string[] | null | undefined,
  languages: SiteLanguages | null | undefined,
): string | undefined {
  if (!languages) return undefined
  const all = languages.all
  for (const tag of requestedTags(input)) {
    const exact = findTag(all, tag)
    if (exact !== undefined) return exact
    const subtag = findTag(all, languageSubtag(tag))
    if (subtag !== undefined) return subtag
  }
  return languages.main
}

/** Tags in preference order. An Accept-Language header is sorted by quality. */
function requestedTags(input: string | readonly string[] | null | undefined): string[] {
  if (input === null || input === undefined) return []
  if (typeof input !== 'string') return input.map((tag) => tag.trim()).filter((tag) => tag !== '')
  if (!input.includes(',') && !input.includes(';')) return input.trim() === '' ? [] : [input.trim()]
  return input
    .split(',')
    .map((part) => {
      const [tag = '', ...params] = part.split(';')
      const quality = params.map((param) => param.trim()).find((param) => param.startsWith('q='))
      return { tag: tag.trim(), q: quality === undefined ? 1 : Number(quality.slice(2)) }
    })
    .filter(({ tag, q }) => tag !== '' && tag !== '*' && q > 0 && !Number.isNaN(q))
    .sort((a, b) => b.q - a.q)
    .map(({ tag }) => tag)
}
