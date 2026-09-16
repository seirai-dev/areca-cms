import { describe, expect, it } from 'vitest'

import { AssetValidationError } from '#/server/assets'

import { setBrandingImage } from './branding'

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
