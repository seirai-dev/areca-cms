import { eq } from 'drizzle-orm'

import { getStorage } from '#/adapters'
import { isValidLogicalKey } from '#/adapters/storage/s3-namespace.mjs'
import { db } from '#/db'
import { asset } from '#/db/schema'
import { createLogger } from '#/server/log'

import {
  derivedImage,
  readAll,
  renderThumbnail,
  THUMBNAIL_SOURCES,
  THUMBNAIL_WIDTHS,
  thumbnailKey,
} from './derived'
import type { ThumbnailFormat } from './derived'
import { streamAssetFile } from './index'

const log = createLogger('asset-thumbnail')

function thumbnailFormat(accept: string | null): ThumbnailFormat | null {
  if (accept?.includes('image/avif')) return 'avif'
  if (accept?.includes('image/webp')) return 'webp'
  return null
}

function thumbnailResponse(bytes: Buffer, format: ThumbnailFormat) {
  return new Response(new Uint8Array(bytes), {
    headers: {
      'Content-Type': `image/${format}`,
      'Content-Length': String(bytes.byteLength),
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Access-Control-Allow-Origin': '*',
      'Cross-Origin-Resource-Policy': 'cross-origin',
      'X-Content-Type-Options': 'nosniff',
      Vary: 'Accept',
    },
  })
}

/** The original file, marked as chosen by `Accept` like the thumbnails. */
async function original(storageKey: string): Promise<Response> {
  const response = await streamAssetFile(storageKey)
  response.headers.set('Vary', 'Accept')
  return response
}

/**
 * `/api/assets/file/<key>?w=<width>`: the image resized to an allowed width,
 * as AVIF or WebP by `Accept`, rendered once and stored next to the original.
 * The original is served instead when resizing would not help: PDFs, GIFs,
 * images already that narrow, unknown files, or a client without either
 * format. Public like the original file route.
 */
export async function streamAssetThumbnail(
  storageKey: string,
  rawWidth: string,
  accept: string | null,
): Promise<Response> {
  const width = THUMBNAIL_WIDTHS.find((allowed) => String(allowed) === rawWidth)
  if (width === undefined) {
    return new Response(
      `Unsupported width. Use one of ${THUMBNAIL_WIDTHS.join(', ')}.`,
      { status: 400 },
    )
  }
  if (!isValidLogicalKey(storageKey)) {
    return new Response('Not found', { status: 404 })
  }
  const format = thumbnailFormat(accept)
  if (!format) return original(storageKey)
  // A stored thumbnail is served only while its asset exists, so one that
  // outlived a delete is never public.
  const row = (
    await db
      .select({ mimeType: asset.mimeType, width: asset.width })
      .from(asset)
      .where(eq(asset.storageKey, storageKey))
      .limit(1)
  ).at(0)
  if (
    !row ||
    !THUMBNAIL_SOURCES.has(row.mimeType) ||
    (row.width !== null && row.width <= width)
  ) {
    return original(storageKey)
  }
  const key = thumbnailKey(storageKey, width, format)
  const stored = await getStorage().get(key)
  if (stored) return thumbnailResponse(await readAll(stored.body), format)
  try {
    const bytes = await derivedImage({
      key,
      sourceKey: storageKey,
      contentType: `image/${format}`,
      render: (source) => renderThumbnail(source, width, format),
    })
    if (!bytes) return new Response('Not found', { status: 404 })
    return thumbnailResponse(bytes, format)
  } catch (error) {
    log.warn('could not render thumbnail', { storageKey, err: error })
    return original(storageKey)
  }
}
