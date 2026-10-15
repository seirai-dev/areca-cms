import { describe, expect, it } from 'vitest'

import {
  SITE_LANGUAGE_CATALOG,
  browserLanguageTag,
  canonicalTag,
  isMultilingual,
  languageEndonym,
  languageEnglishName,
  nonMainLanguages,
  uiLanguageName,
} from './site-languages.ts'
import { getLocale } from '#/paraglide/runtime'

describe('site language catalog', () => {
  it('lists the common tags, each a canonical BCP 47 tag, once', () => {
    for (const tag of [
      'nl',
      'en',
      'fr',
      'de',
      'es',
      'it',
      'pt',
      'pl',
      'tr',
      'ar',
      'zh',
      'ja',
      'nl-BE',
      'fr-BE',
      'en-GB',
      'en-US',
      'de-CH',
      'pt-BR',
    ]) {
      expect(SITE_LANGUAGE_CATALOG, tag).toContain(tag)
    }
    for (const tag of SITE_LANGUAGE_CATALOG) {
      expect(canonicalTag(tag), tag).toBe(tag)
    }
    expect(new Set(SITE_LANGUAGE_CATALOG).size).toBe(
      SITE_LANGUAGE_CATALOG.length,
    )
  })

  it('names languages in their own language and in English', () => {
    expect(languageEndonym('nl')).toBe('Nederlands')
    expect(languageEndonym('de')).toBe('Deutsch')
    expect(languageEnglishName('nl')).toBe('Dutch')
    expect(languageEnglishName('en-GB')).toBe('British English')
    // ICU's own name for Belgian Dutch: a real endonym, not the tag.
    expect(languageEndonym('nl-BE')).toBe('Vlaams')
  })

  it('falls back to the tag for an unknown or invalid tag', () => {
    expect(languageEndonym('zz-ZZ-not-a-tag')).toBe('zz-ZZ-not-a-tag')
  })

  it('capitalises the first letter of a name, in the language itself', () => {
    expect(languageEndonym('fr')).toBe('Français')
    expect(languageEndonym('tr')).toBe('Türkçe')
  })

  it('names a language in the CMS interface language', () => {
    expect(uiLanguageName('nl')).toBe(
      new Intl.DisplayNames([getLocale()], { type: 'language' }).of('nl'),
    )
    expect(uiLanguageName('zz-ZZ-not-a-tag')).toBe('zz-ZZ-not-a-tag')
  })
})

describe('canonicalTag', () => {
  it('normalises case and rejects malformed tags', () => {
    expect(canonicalTag('nl-be')).toBe('nl-BE')
    expect(canonicalTag(' en ')).toBe('en')
    expect(canonicalTag('not a tag!')).toBeNull()
    expect(canonicalTag('')).toBeNull()
  })
})

describe('isMultilingual', () => {
  it('is false without languages or with one language', () => {
    expect(isMultilingual(null)).toBe(false)
    expect(isMultilingual(undefined)).toBe(false)
    expect(isMultilingual({ main: 'nl', all: ['nl'] })).toBe(false)
  })

  it('is true with two or more languages', () => {
    expect(isMultilingual({ main: 'nl', all: ['nl', 'en'] })).toBe(true)
  })
})

describe('nonMainLanguages', () => {
  it('lists the other languages in site order', () => {
    expect(nonMainLanguages({ main: 'en', all: ['nl', 'en', 'fr'] })).toEqual([
      'nl',
      'fr',
    ])
  })
})

describe('browserLanguageTag', () => {
  it('uses the catalog tag, or its base language, or English', () => {
    expect(browserLanguageTag('nl-NL')).toBe('nl')
    expect(browserLanguageTag('nl-BE')).toBe('nl-BE')
    expect(browserLanguageTag('tr')).toBe('tr')
    expect(browserLanguageTag('xx-YY')).toBe('en')
    expect(browserLanguageTag('')).toBe('en')
  })
})
