import { describe, expect, it } from 'vitest'

import { humanizeSlug } from './helpers'

describe('humanizeSlug', () => {
  it('turns a slug into sentence-case words', () => {
    expect(humanizeSlug('poster-series-for-the-autumn-campaign')).toBe(
      'Poster series for the autumn campaign',
    )
    expect(humanizeSlug('senior_designer')).toBe('Senior designer')
    expect(humanizeSlug('2026-plans')).toBe('2026 plans')
    expect(humanizeSlug('')).toBe('')
  })
})
