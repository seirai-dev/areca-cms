import { describe, expect, it } from 'vitest'

import { isValidSlug } from './slug'

describe('isValidSlug', () => {
  it('accepts lowercase words joined by single hyphens', () => {
    expect(isValidSlug('acme')).toBe(true)
    expect(isValidSlug('acme-website-2')).toBe(true)
    expect(isValidSlug('2026')).toBe(true)
  })

  it('rejects anything else', () => {
    for (const value of [
      '',
      'Acme',
      'acme site',
      'acme_site',
      '-acme',
      'acme-',
      'acme--site',
      'acme/site',
      'acmé',
    ]) {
      expect(isValidSlug(value), value).toBe(false)
    }
  })
})
