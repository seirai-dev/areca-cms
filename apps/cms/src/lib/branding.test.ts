import { describe, expect, it } from 'vitest'

import {
  DEFAULT_BRANDING,
  accentVariables,
  brandingCss,
  fontStylesheetUrl,
  hexToOklch,
  isFontKey,
  normalizeHex,
} from './branding.ts'

describe('normalizeHex', () => {
  it('expands short hex and lowercases', () => {
    expect(normalizeHex('#ABC')).toBe('#aabbcc')
    expect(normalizeHex(' #1E90FF ')).toBe('#1e90ff')
  })

  it('rejects anything that is not a hex colour', () => {
    expect(normalizeHex('red')).toBeNull()
    expect(normalizeHex('#12345')).toBeNull()
    expect(normalizeHex('1e90ff')).toBeNull()
  })
})

describe('hexToOklch', () => {
  it('maps white and black to the lightness extremes', () => {
    expect(hexToOklch('#ffffff')?.l).toBeCloseTo(1, 2)
    expect(hexToOklch('#000000')?.l).toBeCloseTo(0, 2)
  })

  it('recovers a red-ish hue for pure red', () => {
    const red = hexToOklch('#ff0000')
    expect(red).not.toBeNull()
    expect(red!.h).toBeGreaterThan(25)
    expect(red!.h).toBeLessThan(35)
    expect(red!.c).toBeGreaterThan(0.2)
  })
})

describe('accentVariables', () => {
  it('produces the three brand scales with fixed lightness steps', () => {
    const vars = accentVariables('#1e90ff')
    expect(vars).not.toBeNull()
    expect(Object.keys(vars!)).toHaveLength(11 * 3 + 1)
    expect(vars!['--color-clay-400']).toMatch(/^oklch\(50\.32% /)
    expect(vars!['--color-fern-500']).toMatch(/^oklch\(58\.83% /)
    // moss is the softer tint of the same hue.
    const fern = vars!['--color-fern-500']!.split(' ')
    const moss = vars!['--color-moss-500']!.split(' ')
    expect(Number(moss[1])).toBeLessThan(Number(fern[1]))
    expect(moss[2]).toBe(fern[2])
  })

  it('returns null for invalid input', () => {
    expect(accentVariables('nope')).toBeNull()
  })
})

describe('brandingCss', () => {
  it('is empty for the defaults', () => {
    expect(brandingCss(DEFAULT_BRANDING)).toBe('')
  })

  it('emits a font override and accent block when customised', () => {
    const css = brandingCss({ accentColor: '#336699', font: 'inter' })
    expect(css).toContain('--color-clay-400:oklch(')
    expect(css).toContain("--font-sans:'Inter'")
    expect(css).toContain('.dark{--success:')
  })
})

describe('fonts', () => {
  it('has a Google stylesheet for hosted fonts and none for system', () => {
    expect(fontStylesheetUrl('inter')).toContain('fonts.googleapis.com')
    expect(fontStylesheetUrl('system')).toBeNull()
    expect(isFontKey('inter')).toBe(true)
    expect(isFontKey('comic-sans')).toBe(false)
  })
})
