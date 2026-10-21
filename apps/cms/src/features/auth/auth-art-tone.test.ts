import { describe, expect, it } from 'vitest'

import { accentTone, relativeLuminance } from './auth-art-tone'

describe('accentTone', () => {
  it('treats the default iris as normal', () => {
    expect(accentTone(null)).toBe('normal')
    expect(accentTone('#5856d6')).toBe('normal')
  })

  it('marks light accents as bright', () => {
    expect(accentTone('#ffeb3b')).toBe('bright')
    expect(accentTone('#a7f3d0')).toBe('bright')
  })

  it('marks very dark accents as deep', () => {
    expect(accentTone('#0b1d3a')).toBe('deep')
    expect(accentTone('#000')).toBe('deep')
  })

  it('falls back to normal for values it cannot read', () => {
    expect(accentTone('oklch(0.6 0.2 280)')).toBe('normal')
  })
})

describe('relativeLuminance', () => {
  it('matches the WCAG endpoints', () => {
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1)
    expect(relativeLuminance('#000000')).toBeCloseTo(0)
    expect(relativeLuminance('#fff')).toBeCloseTo(1)
  })
})
