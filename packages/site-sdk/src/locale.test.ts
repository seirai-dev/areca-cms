import { describe, expect, it } from 'vitest'
import { matchLocale } from './locale.js'

const languages = { main: 'nl', all: ['nl', 'en', 'fr-BE'] }

describe('matchLocale', () => {
  it('returns undefined without languages', () => {
    expect(matchLocale('en', null)).toBeUndefined()
    expect(matchLocale('en', undefined)).toBeUndefined()
  })

  it('returns the exact tag, case-insensitively', () => {
    expect(matchLocale('EN', languages)).toBe('en')
    expect(matchLocale('fr-be', languages)).toBe('fr-BE')
  })

  it('falls back to the language subtag', () => {
    expect(matchLocale('en-GB', languages)).toBe('en')
    expect(matchLocale('nl-BE', languages)).toBe('nl')
  })

  it('returns the main language when nothing matches', () => {
    expect(matchLocale('de', languages)).toBe('nl')
    expect(matchLocale(undefined, languages)).toBe('nl')
    expect(matchLocale(null, languages)).toBe('nl')
    expect(matchLocale([], languages)).toBe('nl')
  })

  it('reads an Accept-Language header in quality order', () => {
    expect(matchLocale('de;q=0.9, en;q=0.8', languages)).toBe('en')
    expect(matchLocale('en;q=0.2, fr-BE;q=0.9', languages)).toBe('fr-BE')
    expect(matchLocale('*, en;q=0', languages)).toBe('nl')
  })

  it('takes an array of tags in order', () => {
    expect(matchLocale(['de', 'fr-BE', 'en'], languages)).toBe('fr-BE')
  })

  it('ignores tags that are not valid', () => {
    expect(matchLocale('!!', languages)).toBe('nl')
  })
})
