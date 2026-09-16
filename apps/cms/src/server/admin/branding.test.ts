import { describe, expect, it } from 'vitest'

import { AssetValidationError } from '#/server/assets'

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
