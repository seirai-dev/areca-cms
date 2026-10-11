import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { AssetValidationError } from './errors'
import { validateImageBytes } from './image-validation'

const png = () =>
  sharp({ create: { width: 2, height: 3, channels: 4, background: '#ee5522' } })
    .png()
    .toBuffer()
describe('image byte validation', () => {
  it('accepts decoded dimensions and rejects a false declared format', async () => {
    const bytes = await png()
    expect(await validateImageBytes(bytes, 'image/png')).toEqual({
      width: 2,
      height: 3,
    })
    await expect(
      validateImageBytes(bytes, 'image/jpeg'),
    ).rejects.toBeInstanceOf(AssetValidationError)
  })
  it.each(['image/png', 'image/jpeg', 'image/x-icon'])(
    'rejects forged and corrupt %s images',
    async (mime) => {
      await expect(
        validateImageBytes(Buffer.from('<script>alert(1)</script>'), mime),
      ).rejects.toBeInstanceOf(AssetValidationError)
      await expect(
        validateImageBytes(
          Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
          mime,
        ),
      ).rejects.toBeInstanceOf(AssetValidationError)
    },
  )
  it('accepts a valid PNG-backed icon and rejects an out-of-bounds directory', async () => {
    const image = await png()
    const header = Buffer.alloc(22)
    header.writeUInt16LE(1, 2)
    header.writeUInt16LE(1, 4)
    header[6] = 2
    header[7] = 3
    header.writeUInt32LE(image.length, 14)
    header.writeUInt32LE(22, 18)
    const icon = Buffer.concat([header, image])
    await expect(validateImageBytes(icon, 'image/x-icon')).resolves.toEqual({
      width: null,
      height: null,
    })
    icon.writeUInt32LE(icon.length + 1, 18)
    await expect(
      validateImageBytes(icon, 'image/x-icon'),
    ).rejects.toBeInstanceOf(AssetValidationError)
  })
})
