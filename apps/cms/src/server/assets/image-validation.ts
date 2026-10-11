import sharp from 'sharp'
import { AssetValidationError } from './errors'

const FORMATS: Record<string, string> = {
  'image/jpeg': 'jpeg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
}
const MAX_IMAGE_PIXELS = 40_000_000

/** Validate the bytes before assigning a browser-visible image content type. */
export async function validateImageBytes(buffer: Buffer, mimeType: string) {
  try {
    if (
      mimeType === 'image/x-icon' ||
      mimeType === 'image/vnd.microsoft.icon'
    ) {
      await validateIcon(buffer)
      return { width: null, height: null }
    }
    const expectedFormat = FORMATS[mimeType]
    if (!expectedFormat) throw new Error('Unsupported image type')
    const image = sharp(buffer, {
      limitInputPixels: MAX_IMAGE_PIXELS,
      failOn: 'warning',
      animated: true,
    })
    const metadata = await image.metadata()
    if (
      metadata.format !== expectedFormat ||
      !metadata.width ||
      !metadata.height
    )
      throw new Error('Image contents do not match the selected file type')
    // Header-only metadata can accept truncated images. Decode the pixels too.
    await image.stats()
    return {
      width: metadata.width,
      height: metadata.pageHeight ?? metadata.height,
    }
  } catch {
    throw new AssetValidationError(
      'Upload a valid image whose contents match its file type (maximum 40 million pixels)',
    )
  }
}

async function validateIcon(buffer: Buffer) {
  if (
    buffer.length < 6 ||
    buffer.readUInt16LE(0) !== 0 ||
    buffer.readUInt16LE(2) !== 1
  )
    throw new Error('Invalid icon header')
  const count = buffer.readUInt16LE(4)
  const directoryEnd = 6 + count * 16
  if (!count || count > 256 || buffer.length < directoryEnd)
    throw new Error('Invalid icon directory')
  for (let i = 0; i < count; i++) {
    const entry = 6 + i * 16
    const length = buffer.readUInt32LE(entry + 8)
    const offset = buffer.readUInt32LE(entry + 12)
    if (!length || offset < directoryEnd || offset + length > buffer.length)
      throw new Error('Invalid icon image')
    const image = buffer.subarray(offset, offset + length)
    if (
      image
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    ) {
      const dimensions = await validateImageBytes(image, 'image/png')
      if (
        dimensions.width !== (buffer[entry] || 256) ||
        dimensions.height !== (buffer[entry + 1] || 256)
      )
        throw new Error('Icon directory dimensions do not match its image')
    } else {
      if (
        image.length < 40 ||
        image.readUInt32LE(0) < 40 ||
        image.readUInt32LE(0) > image.length
      )
        throw new Error('Invalid icon bitmap')
      const width = image.readInt32LE(4)
      const height = image.readInt32LE(8)
      const bits = image.readUInt16LE(14)
      if (
        width < 1 ||
        width > 256 ||
        height < 2 ||
        height > 512 ||
        image.readUInt16LE(12) !== 1 ||
        ![1, 4, 8, 16, 24, 32].includes(bits) ||
        width !== (buffer[entry] || 256) ||
        height / 2 !== (buffer[entry + 1] || 256)
      )
        throw new Error('Invalid icon bitmap dimensions')
      const rowBytes = Math.ceil((width * bits) / 32) * 4
      if (
        image.length <
        image.readUInt32LE(0) + rowBytes * Math.floor(height / 2)
      )
        throw new Error('Truncated icon bitmap')
    }
  }
}
