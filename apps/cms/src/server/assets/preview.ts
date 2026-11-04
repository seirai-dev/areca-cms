import sharp from 'sharp'

import { getStorage } from '#/adapters'
import { createLogger } from '#/server/log'

import type { Asset } from './index'

/** Long side of a preview, in pixels. Enough for a model to tell images apart. */
export const PREVIEW_MAX_SIDE = 1024
const PREVIEW_QUALITY = 72
const MAX_SOURCE_PIXELS = 40_000_000

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

async function readAll(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const chunks: Uint8Array[] = []
  const reader = stream.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
  }
  return Buffer.concat(chunks)
}

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
 * never fails the tool call.
 */
export async function assetPreview(
  row: Pick<Asset, 'id' | 'storageKey' | 'mimeType'>,
): Promise<AssetPreview | null> {
  if (!PREVIEWABLE.has(row.mimeType)) return null
  try {
    const object = await getStorage().get(row.storageKey)
    if (!object) return null
    const preview = await renderPreview(await readAll(object.body))
    return { data: preview.toString('base64'), mimeType: 'image/jpeg' }
  } catch (error) {
    log.warn('could not render asset preview', { assetId: row.id, err: error })
    return null
  }
}
