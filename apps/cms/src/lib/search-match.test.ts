import { describe, expect, it } from 'vitest'

import { matchesSearch } from './search-match'

describe('matchesSearch', () => {
  it('matches every word of the query somewhere in the text', () => {
    expect(matchesSearch('go live', ['Go live now'], 'en')).toBe(true)
    expect(matchesSearch('go sign', ['Go live now'], 'en')).toBe(false)
  })

  it('ignores case and diacritics', () => {
    expect(matchesSearch('VOOR', ['Vóór publiceren'], 'nl')).toBe(true)
    expect(matchesSearch('voor', ['Vóór publiceren'], 'nl')).toBe(true)
  })

  it('does not match scattered letters, unlike a fuzzy filter', () => {
    expect(matchesSearch('lente', ['Action go live publish'], 'nl')).toBe(false)
    expect(matchesSearch('lente', ['Lente-menu'], 'nl')).toBe(true)
  })

  it('treats an empty query as a match', () => {
    expect(matchesSearch('  ', ['anything'], 'en')).toBe(true)
  })

  it('folds Turkish dotted i for the Turkish locale', () => {
    expect(matchesSearch('İÇERİK', ['içerik'], 'tr')).toBe(true)
  })
})
