import { describe, expect, it } from 'vitest'

import {
  DEFAULT_BRANDING,
  accentVariables,
  brandingCss,
  brandingPreviewStyle,
  contrastRatio,
  fontStylesheetUrl,
  hexToOklch,
  isFontKey,
  normalizeHex,
  normalizeAdvancedColors,
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
  it('overrides the semantic accent tokens in both modes', () => {
    const light = accentVariables('#1e90ff', 'light')
    const dark = accentVariables('#1e90ff', 'dark')
    expect(light).not.toBeNull()
    expect(Object.keys(light!).sort()).toEqual([
      '--color-action-primary',
      '--color-action-primary-hover',
      '--color-action-primary-text',
      '--color-icon-accent',
      '--color-status-success',
      '--color-text-accent',
    ])
    expect(light!['--color-action-primary']).toMatch(/^oklch\(/)
    // Hover is a lighter step than the accent itself.
    const lightness = (value: string) => Number(value.match(/([\d.]+)%/)![1])
    expect(lightness(light!['--color-action-primary-hover'])).toBeGreaterThan(
      lightness(light!['--color-action-primary']),
    )
    // Accent text darkens in light mode and lightens in dark mode.
    expect(lightness(light!['--color-text-accent'])).toBeLessThan(
      lightness(dark!['--color-text-accent']),
    )
    // Both modes share the same hue.
    expect(light!['--color-action-primary'].split(' ')[2]).toBe(
      dark!['--color-action-primary'].split(' ')[2],
    )
  })

  it('picks a readable text colour on the accent', () => {
    expect(accentVariables('#111111')!['--color-action-primary-text']).toBe(
      '#ffffff',
    )
    expect(accentVariables('#fae884')!['--color-action-primary-text']).toBe(
      '#111111',
    )
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
    const css = brandingCss({
      ...DEFAULT_BRANDING,
      accentColor: '#336699',
      font: 'dm-sans',
    })
    expect(css).toContain('--color-action-primary:oklch(')
    expect(css).toContain("--font-sans:'DM Sans'")
    expect(css).toContain(':root:not(.dark){--color-action-primary')
    expect(css).toContain('html.dark{--color-action-primary')
  })

  it('only emits stored advanced colours while advanced mode is active', () => {
    const colors = {
      light: { background: '#ffffff', surface: '#f5f5f5' },
      dark: { background: '#101010', foreground: '#ffffff' },
    }
    const inactive = brandingCss({
      ...DEFAULT_BRANDING,
      advancedColors: colors,
    })
    expect(inactive).not.toContain('--color-background-default:#ffffff')

    const active = brandingCss({
      ...DEFAULT_BRANDING,
      advancedColorsEnabled: true,
      advancedColors: colors,
    })
    expect(active).toContain(
      ':root:not(.dark){--color-background-default:#ffffff;--color-background-surface:#f5f5f5;--color-background-elevated:#f5f5f5}',
    )
    expect(active).toContain(
      'html.dark{--color-background-default:#101010;--color-text-primary:#ffffff}',
    )
  })

  it('uses the selected palette in the scoped preview', () => {
    const style = brandingPreviewStyle(
      {
        ...DEFAULT_BRANDING,
        advancedColorsEnabled: true,
        advancedColors: {
          light: {},
          dark: { surface: '#111111' },
        },
      },
      'dark',
    )
    expect(style['--color-background-surface']).toBe('#111111')
    expect(style['--color-background-elevated']).toBe('#111111')
  })
})

describe('advanced colours', () => {
  it('normalizes supported keys and ignores unknown or invalid values', () => {
    expect(
      normalizeAdvancedColors({
        light: { background: '#ABC', madeUp: '#ffffff' },
        dark: { foreground: 'black', surface: '#123456' },
      }),
    ).toEqual({
      light: { background: '#aabbcc' },
      dark: { surface: '#123456' },
    })
  })

  it('calculates WCAG contrast ratios', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21)
    expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.48, 1)
  })
})

describe('fonts', () => {
  it('has a Google stylesheet for hosted fonts and none for system', () => {
    expect(fontStylesheetUrl('dm-sans')).toContain('fonts.googleapis.com')
    expect(fontStylesheetUrl('inter')).toBeNull()
    expect(fontStylesheetUrl('system')).toBeNull()
    expect(isFontKey('inter')).toBe(true)
    expect(isFontKey('comic-sans')).toBe(false)
  })
})
