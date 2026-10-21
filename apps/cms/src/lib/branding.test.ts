import { describe, expect, it } from 'vitest'

import {
  DEFAULT_BRANDING,
  accentVariables,
  brandingCss,
  brandingPreviewStyle,
  contrastRatio,
  fontEntry,
  fontStylesheetUrl,
  hexToOklch,
  isFontKey,
  loginTaglineFor,
  loginTaglinesSchema,
  normalizeHex,
  normalizeAdvancedColors,
  normalizeLoginTaglines,
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
  const lightness = (value: string) => Number(value.match(/([\d.]+)%/)![1])
  const hue = (value: string) => value.split(' ')[2]

  it('re-tints the accent tokens, never the ink primary button', () => {
    const light = accentVariables('#1e90ff', 'light')
    const dark = accentVariables('#1e90ff', 'dark')
    expect(light).not.toBeNull()
    expect(Object.keys(light!).sort()).toEqual([
      '--color-accent',
      '--color-accent-contrast',
      '--color-accent-hover',
      '--color-accent-soft',
      '--color-accent-text',
      '--color-border-focus',
      '--color-icon-accent',
      '--color-status-info',
      '--color-status-info-bg',
      '--color-text-accent',
    ])
    expect(Object.keys(dark!).sort()).toEqual(Object.keys(light!).sort())
    for (const key of Object.keys(light!)) {
      expect(key.startsWith('--color-action-')).toBe(false)
    }
    expect(light!['--color-accent']).toMatch(/^oklch\(/)
    // Focus rings follow the accent.
    expect(light!['--color-border-focus']).toBe(light!['--color-accent'])
    // The soft fill is the accent at low alpha.
    expect(light!['--color-accent-soft']).toMatch(/\/ 0\.12\)$/)
    expect(dark!['--color-accent-soft']).toMatch(/\/ 0\.16\)$/)
  })

  it('darkens on hover in light mode and lifts in dark mode', () => {
    const light = accentVariables('#5856d6', 'light')!
    const dark = accentVariables('#5856d6', 'dark')!
    expect(lightness(light['--color-accent-hover'])).toBeLessThan(
      lightness(light['--color-accent']),
    )
    expect(lightness(dark['--color-accent-hover'])).toBeGreaterThan(
      lightness(dark['--color-accent']),
    )
    // Dark mode lifts the accent so it reads on near-black.
    expect(lightness(dark['--color-accent'])).toBeGreaterThan(
      lightness(light['--color-accent']),
    )
    // Accent text darkens in light mode and lightens in dark mode.
    expect(lightness(light['--color-text-accent'])).toBeLessThan(
      lightness(dark['--color-text-accent']),
    )
    // Both modes share the same hue.
    expect(hue(light['--color-accent'])).toBe(hue(dark['--color-accent']))
  })

  it('picks a readable text colour on the accent', () => {
    expect(accentVariables('#111111')!['--color-accent-contrast']).toBe(
      '#ffffff',
    )
    expect(accentVariables('#fae884')!['--color-accent-contrast']).toBe(
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
    expect(css).toContain('--color-accent:oklch(')
    expect(css).not.toContain('--color-action-primary')
    expect(css).toContain("--font-sans:'DM Sans'")
    expect(css).toContain(':root:not(.dark){--color-accent:')
    expect(css).toContain('html.dark{--color-accent:')
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

  it('falls back to the default font for unknown stored keys', () => {
    expect(fontStylesheetUrl('comic-sans')).toBeNull()
    expect(fontEntry('comic-sans').label).toBe('Inter')
    expect(
      brandingCss({ ...DEFAULT_BRANDING, font: 'comic-sans' as never }),
    ).toBe('')
  })
})

describe('sign-in tagline', () => {
  it('returns the trimmed text for the requested language', () => {
    const branding = {
      loginTagline: { en: '  Your website  ', nl: 'Je website', tr: null },
    }
    expect(loginTaglineFor(branding, 'en')).toBe('Your website')
    expect(loginTaglineFor(branding, 'nl')).toBe('Je website')
  })

  it('is null for a language with no text, so the built-in text shows', () => {
    const branding = { loginTagline: { en: '   ', nl: null, tr: null } }
    expect(loginTaglineFor(branding, 'en')).toBeNull()
    expect(loginTaglineFor(branding, 'tr')).toBeNull()
    expect(loginTaglineFor(DEFAULT_BRANDING, 'nl')).toBeNull()
  })

  it('is null for a language the app does not ship', () => {
    expect(loginTaglineFor(DEFAULT_BRANDING, 'de')).toBeNull()
  })

  it('normalises stored values per language', () => {
    expect(normalizeLoginTaglines({ en: ' Hi ', nl: '', tr: 4 })).toEqual({
      en: 'Hi',
      nl: null,
      tr: null,
    })
    expect(normalizeLoginTaglines(null)).toEqual({
      en: null,
      nl: null,
      tr: null,
    })
  })
})

describe('loginTaglinesSchema', () => {
  it('trims values and turns empty ones into null', () => {
    expect(
      loginTaglinesSchema.parse({ en: '  Hello  ', nl: '   ', tr: '' }),
    ).toEqual({ en: 'Hello', nl: null, tr: null })
  })

  it('accepts a missing or null request', () => {
    expect(loginTaglinesSchema.parse(undefined)).toBeUndefined()
    expect(loginTaglinesSchema.parse(null)).toBeNull()
    expect(loginTaglinesSchema.parse({})).toEqual({})
  })

  it('allows exactly 80 characters and no more', () => {
    const eighty = 'a'.repeat(80)
    expect(loginTaglinesSchema.parse({ en: eighty })?.en).toBe(eighty)
    expect(loginTaglinesSchema.safeParse({ en: `${eighty}a` }).success).toBe(
      false,
    )
  })

  it('rejects line breaks', () => {
    expect(
      loginTaglinesSchema.safeParse({ tr: 'Birinci\nikinci' }).success,
    ).toBe(false)
    expect(loginTaglinesSchema.safeParse({ tr: 'Birinci\r\n' }).success).toBe(
      true,
    )
  })
})
