import sharp from 'sharp'

import { createLogger } from '#/server/log'

import { derivedImage, MAX_SOURCE_PIXELS, previewKey } from './derived'
import type { Asset } from './index'

/** Long side of a preview, in pixels. Enough for a model to tell images apart. */
export const PREVIEW_MAX_SIDE = 1024
const PREVIEW_QUALITY = 72

const PREVIEWABLE = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
])

export type AssetPreview = {
  /** Base64 JPEG bytes. */
  data: string
  mimeType: 'image/jpeg'
}

const log = createLogger('asset-preview')

/** Shrinks image bytes to a small JPEG: transparency on white, first frame of a GIF. */
export async function renderPreview(bytes: Buffer): Promise<Buffer> {
  return sharp(bytes, { limitInputPixels: MAX_SOURCE_PIXELS })
    .rotate()
    .resize({
      width: PREVIEW_MAX_SIDE,
      height: PREVIEW_MAX_SIDE,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: PREVIEW_QUALITY, mozjpeg: true })
    .toBuffer()
}

/**
 * A small JPEG of an image asset, so an AI client can see what it holds. Null
 * for a PDF, or when the file cannot be read: a preview is a convenience and
 * never fails the tool call. Rendered once (three at a time per process) and
 * stored next to the original for later calls.
 */
export async function assetPreview(
  row: Pick<Asset, 'id' | 'storageKey' | 'mimeType'>,
): Promise<AssetPreview | null> {
  if (!PREVIEWABLE.has(row.mimeType)) return null
  try {
    const preview = await derivedImage({
      key: previewKey(row.storageKey),
      sourceKey: row.storageKey,
      contentType: 'image/jpeg',
      render: renderPreview,
    })
    return preview
      ? { data: preview.toString('base64'), mimeType: 'image/jpeg' }
      : null
  } catch (error) {
    log.warn('could not render asset preview', { assetId: row.id, err: error })
    return null
  }
}
