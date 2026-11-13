import { eq } from 'drizzle-orm'
import sharp from 'sharp'

import { getStorage } from '#/adapters'
import { db } from '#/db'
import { asset } from '#/db/schema'
import { THUMBNAIL_WIDTHS } from '#/lib/content/utils'
import { createLogger } from '#/server/log'

const log = createLogger('derived-image')

/** Largest source image decoded, in pixels. */
export const MAX_SOURCE_PIXELS = 40_000_000

export { THUMBNAIL_WIDTHS }
export type ThumbnailFormat = 'avif' | 'webp'
const THUMBNAIL_FORMATS: ThumbnailFormat[] = ['avif', 'webp']

/*
 * Images derived from an asset (thumbnails, the MCP preview) are rendered once
 * and stored under `derived/<storageKey>/`. Storage keys never change, so a
 * stored copy never goes stale; deleting the asset queues every derived key.
 * A render that finishes after the delete removes its own copy, and the
 * thumbnail route serves a stored copy only while the asset row exists.
 */
export function thumbnailKey(
  storageKey: string,
  width: number,
  format: ThumbnailFormat,
) {
  return `derived/${storageKey}/w${width}.${format}`
}

export function previewKey(storageKey: string) {
  return `derived/${storageKey}/preview.jpg`
}

export function derivedStorageKeys(storageKey: string): string[] {
  return [
    ...THUMBNAIL_WIDTHS.flatMap((width) =>
      THUMBNAIL_FORMATS.map((format) =>
        thumbnailKey(storageKey, width, format),
      ),
    ),
    previewKey(storageKey),
  ]
}

/** Runs at most `max` tasks at once; a finished task hands its slot to the next. */
export function createLimiter(max: number) {
  let active = 0
  const waiting: (() => void)[] = []
  return async function run<T>(task: () => Promise<T>): Promise<T> {
    if (active < max) active++
    else await new Promise<void>((resolve) => waiting.push(resolve))
    try {
      return await task()
    } finally {
      const next = waiting.shift()
      if (next) next()
      else active--
    }
  }
}

// Each render holds a whole source file and its decoded pixels (up to
// 160 MB at the pixel limit), so the process renders three at a time.
const renderSlot = createLimiter(3)
const rendering = new Map<string, Promise<Buffer | null>>()

export async function readAll(
  stream: ReadableStream<Uint8Array>,
): Promise<Buffer> {
  const chunks: Uint8Array[] = []
  const reader = stream.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
  }
  return Buffer.concat(chunks)
}

async function assetExists(storageKey: string): Promise<boolean> {
  const rows = await db
    .select({ id: asset.id })
    .from(asset)
    .where(eq(asset.storageKey, storageKey))
    .limit(1)
  return rows.length > 0
}

/**
 * The stored derived image, or one rendered from the original and stored for
 * next time. Null when the original or its asset row does not exist.
 * Concurrent requests for the same derived key share one render.
 */
export async function derivedImage(input: {
  key: string
  sourceKey: string
  contentType: string
  render: (source: Buffer) => Promise<Buffer>
}): Promise<Buffer | null> {
  const storage = getStorage()
  const stored = await storage.get(input.key)
  if (stored) return readAll(stored.body)
  const pending = rendering.get(input.key)
  if (pending) return pending
  const task = renderSlot(async () => {
    const original = await storage.get(input.sourceKey)
    if (!original) return null
    const bytes = await input.render(await readAll(original.body))
    try {
      await storage.put(input.key, bytes, input.contentType)
    } catch (error) {
      log.warn('could not store derived image', { key: input.key, err: error })
      return bytes
    }
    // The asset may have been deleted, and its derived keys cleaned up,
    // while this rendered.
    if (await assetExists(input.sourceKey)) return bytes
    try {
      await storage.delete(input.key)
    } catch (error) {
      log.warn('could not delete derived image of a deleted asset', {
        key: input.key,
        err: error,
      })
    }
    return null
  }).finally(() => rendering.delete(input.key))
  rendering.set(input.key, task)
  return task
}

/** A thumbnail `width` px wide at most (never enlarged), upright, in `format`. */
export async function renderThumbnail(
  source: Buffer,
  width: number,
  format: ThumbnailFormat,
): Promise<Buffer> {
  const image = sharp(source, { limitInputPixels: MAX_SOURCE_PIXELS })
    .rotate()
    .resize({ width, withoutEnlargement: true })
  return format === 'avif'
    ? image.avif({ quality: 55, effort: 2 }).toBuffer()
    : image.webp({ quality: 75 }).toBuffer()
}

/** Rendered from these source types only. GIFs keep their animation as originals. */
export const THUMBNAIL_SOURCES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
])
