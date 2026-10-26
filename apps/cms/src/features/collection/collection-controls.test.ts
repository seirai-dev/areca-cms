import { describe, expect, it } from 'vitest'

import { statusFilterVisible } from './collection-controls.tsx'

describe('statusFilterVisible', () => {
  it('offers every status tab on a normal site', () => {
    for (const value of [
      'all',
      'draft',
      'published',
      'scheduled',
      'archived',
    ] as const) {
      expect(statusFilterVisible(value, false)).toBe(true)
    }
  })

  it('hides only the scheduled tab on a development site', () => {
    expect(statusFilterVisible('scheduled', true)).toBe(false)
    for (const value of ['all', 'draft', 'published', 'archived'] as const) {
      expect(statusFilterVisible(value, true)).toBe(true)
    }
  })
})
