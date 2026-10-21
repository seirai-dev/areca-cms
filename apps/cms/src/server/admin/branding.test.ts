import { describe, expect, it } from 'vitest'

import { AssetValidationError } from '#/server/assets'

import { EMPTY_LOGIN_TAGLINES, loginTaglineFor } from '#/lib/branding'

import type { BrandingRow } from './branding'
import { setBrandingImage, toBrandingView, updateBranding } from './branding'

describe('branding image validation', () => {
  it.each(['logo', 'favicon'] as const)('rejects SVG for %s', async (kind) => {
    await expect(
      setBrandingImage(
        kind,
        {
          buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
          mimeType: 'image/svg+xml',
        },
        'user',
      ),
    ).rejects.toBeInstanceOf(AssetValidationError)
  })
})

describe('branding colour persistence', () => {
  it('retains inactive advanced colours without applying the mode', () => {
    const view = toBrandingView({
      id: 'default',
      appName: null,
      logoKey: null,
      logoMime: null,
      faviconKey: null,
      faviconMime: null,
      accentColor: null,
      advancedColorsEnabled: false,
      advancedColors: {
        light: { background: '#ABC' },
        dark: {},
      },
      font: null,
      emailFromName: null,
      loginTagline: null,
      updatedBy: null,
      updatedAt: new Date(),
    } satisfies BrandingRow)

    expect(view.advancedColorsEnabled).toBe(false)
    expect(view.advancedColors.light.background).toBe('#aabbcc')
    expect(view.customized).toBe(true)
  })

  it('rejects invalid advanced colours on the server', async () => {
    await expect(
      updateBranding(
        {
          advancedColors: {
            light: { background: 'red' },
            dark: {},
          },
        },
        'user',
      ),
    ).rejects.toBeInstanceOf(AssetValidationError)
  })
})

describe('sign-in tagline', () => {
  const row = (loginTagline: BrandingRow['loginTagline']): BrandingRow => ({
    id: 'default',
    appName: null,
    logoKey: null,
    logoMime: null,
    faviconKey: null,
    faviconMime: null,
    accentColor: null,
    advancedColorsEnabled: false,
    advancedColors: null,
    font: null,
    emailFromName: null,
    loginTagline,
    updatedBy: null,
    updatedAt: new Date(),
  })

  it('maps stored taglines and counts them as customisation', () => {
    const view = toBrandingView(row({ en: ' Your website ', nl: '' }))

    expect(view.loginTagline).toEqual({
      en: 'Your website',
      nl: null,
      tr: null,
    })
    expect(loginTaglineFor(view, 'en')).toBe('Your website')
    expect(view.customized).toBe(true)
  })

  it('leaves the built-in look untouched when no tagline is stored', () => {
    const view = toBrandingView(row(null))

    expect(view.loginTagline).toEqual(EMPTY_LOGIN_TAGLINES)
    expect(view.customized).toBe(false)
  })

  it('rejects a tagline longer than 80 characters or spanning lines', async () => {
    await expect(
      updateBranding({ loginTagline: { en: 'a'.repeat(81) } }, 'user'),
    ).rejects.toBeInstanceOf(AssetValidationError)
    await expect(
      updateBranding({ loginTagline: { nl: 'Een\nTwee' } }, 'user'),
    ).rejects.toBeInstanceOf(AssetValidationError)
  })
})
