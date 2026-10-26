import { describe, expect, it } from 'vitest'

import { DEV_SLUG_ATTEMPTS, devSlugCandidates, pickDevSlug } from './slug'

describe('devSlugCandidates', () => {
  it('starts with <slug>-dev, then numbers from 2', () => {
    expect(devSlugCandidates('acme', 3)).toEqual([
      'acme-dev',
      'acme-dev-2',
      'acme-dev-3',
    ])
  })

  it('offers the default number of attempts', () => {
    expect(devSlugCandidates('acme')).toHaveLength(DEV_SLUG_ATTEMPTS)
  })
})

describe('pickDevSlug', () => {
  it('takes the first free candidate', () => {
    const taken = new Set(['acme-dev'])
    expect(pickDevSlug('acme', (c) => taken.has(c))).toBe('acme-dev-2')
  })

  it('returns the plain candidate when nothing is taken', () => {
    expect(pickDevSlug('acme', () => false)).toBe('acme-dev')
  })

  it('returns null when every candidate is taken', () => {
    expect(pickDevSlug('acme', () => true)).toBeNull()
  })
})
