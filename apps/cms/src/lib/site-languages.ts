/**
 * Site language helpers for the CMS UI: which languages can be added, how
 * they are named, and whether a site is multilingual at all. Pure (no server
 * code), so it is shared by the settings, schema editor, entry list and
 * library. Single-language sites (`languages` null, or one language) must
 * not show any of the multilingual controls: check `isMultilingual` first.
 */
import { getLocale } from '#/paraglide/runtime'

import type { SiteLanguages } from './types.ts'

/**
 * Common BCP 47 tags offered in the "Add language" list. Any other valid tag
 * can still be typed in. Order is the order of the list before searching.
 */
export const SITE_LANGUAGE_CATALOG = [
  'nl',
  'nl-BE',
  'en',
  'en-GB',
  'en-US',
  'en-IE',
  'en-AU',
  'en-CA',
  'fr',
  'fr-BE',
  'fr-CH',
  'fr-CA',
  'de',
  'de-AT',
  'de-CH',
  'es',
  'es-MX',
  'es-419',
  'it',
  'it-CH',
  'pt',
  'pt-BR',
  'pt-PT',
  'pl',
  'cs',
  'sk',
  'hu',
  'ro',
  'bg',
  'el',
  'hr',
  'sl',
  'sr',
  'bs',
  'mk',
  'sq',
  'lt',
  'lv',
  'et',
  'fi',
  'sv',
  'da',
  'nb',
  'is',
  'ga',
  'ca',
  'eu',
  'gl',
  'mt',
  'lb',
  'ru',
  'uk',
  'tr',
  'ar',
  'he',
  'fa',
  'ur',
  'hi',
  'bn',
  'id',
  'ms',
  'vi',
  'th',
  'fil',
  'zh',
  'zh-TW',
  'ja',
  'ko',
  'sw',
  'af',
] as const

/**
 * Canonical form of a tag: `nl-be` becomes `nl-BE`. Null when the tag is not
 * a well-formed BCP 47 tag.
 */
export function canonicalTag(tag: string): string | null {
  try {
    return Intl.getCanonicalLocales(tag.trim()).at(0) ?? null
  } catch {
    return null
  }
}

/**
 * Language name in the language itself, capitalised ("Nederlands",
 * "Deutsch", "Français"). For tabs, the settings list and alt labels only.
 */
export function languageEndonym(tag: string): string {
  const name = displayName(tag, tag)
  // An unknown tag is shown as typed: it is not a name to capitalise.
  if (name === tag) return tag
  const first = name.charAt(0)
  let upper = first.toUpperCase()
  try {
    upper = first.toLocaleUpperCase(tag)
  } catch {
    /* an unusual tag: keep the plain upper-case form */
  }
  return upper + name.slice(1)
}

/** Language name in English ("Dutch", "Dutch (Belgium)"). */
export function languageEnglishName(tag: string): string {
  return displayName('en', tag)
}

/**
 * Language name in the CMS interface language: "Dutch" in English,
 * "Engels" in Dutch. Use it inside sentences, tooltips, labels and dialogs.
 */
export function uiLanguageName(tag: string): string {
  return displayName(getLocale(), tag)
}

function displayName(locale: string, tag: string): string {
  try {
    const names = new Intl.DisplayNames([locale], { type: 'language' })
    const name = names.of(tag)
    // `of` echoes unknown tags back; an echo of the tag is not a name.
    return name && name !== tag ? name : tag
  } catch {
    return tag
  }
}

/** True when the site publishes in two or more languages. */
export function isMultilingual(
  languages: SiteLanguages | null | undefined,
): languages is SiteLanguages {
  return Boolean(languages && languages.all.length >= 2)
}

/** The languages besides main, in site order. */
export function nonMainLanguages(languages: SiteLanguages): string[] {
  return languages.all.filter((locale) => locale !== languages.main)
}

/**
 * The language the browser asks for, as a tag the catalog knows: the base
 * language when it is in the catalog (`nl-NL` becomes `nl`), otherwise `en`.
 */
export function browserLanguageTag(
  language: string | undefined = typeof navigator === 'undefined'
    ? undefined
    : navigator.language,
): string {
  const canonical = language ? canonicalTag(language) : null
  if (!canonical) return 'en'
  if ((SITE_LANGUAGE_CATALOG as readonly string[]).includes(canonical)) {
    return canonical
  }
  const base = canonical.split('-')[0] ?? 'en'
  return (SITE_LANGUAGE_CATALOG as readonly string[]).includes(base)
    ? base
    : 'en'
}
