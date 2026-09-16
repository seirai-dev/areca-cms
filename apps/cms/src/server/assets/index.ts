import { and, desc, eq, ilike, or, sql } from 'drizzle-orm'
import type { InferSelectModel } from 'drizzle-orm'
import sharp from 'sharp'

import { getStorage } from '#/adapters'
import { db } from '#/db'
import { asset, entry } from '#/db/schema'
import { env } from '#/env'
import { m } from '#/paraglide/messages'

export type Asset = InferSelectModel<typeof asset>

export type ResolvedAssetValue = {
  url: string
  width: number | null
  height: number | null
  alt: string
  mimeType: string
}

const ALLOWED_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf',
])

const RASTER_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
])

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'application/pdf': 'pdf',
}

const MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  pdf: 'application/pdf',
}

const ASSET_FILE_PREFIX = '/api/assets/file/'

const MAX_SIZE_BYTES = 20 * 1024 * 1024

export class AssetValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AssetValidationError'
  }
}

export class AssetInUseError extends Error {
  constructor(public readonly usage: number) {
    super(m.server_asset_in_use({ usage: String(usage) }))
    this.name = 'AssetInUseError'
  }
}

export async function uploadAsset(input: {
  organizationId: string
  file: { buffer: Buffer; filename: string; mimeType: string }
  actorId: string
  altText?: string
}): Promise<Asset> {
  const mimeType = input.file.mimeType.toLowerCase()
  if (!ALLOWED_MIMES.has(mimeType)) {
    throw new AssetValidationError(
      m.server_unsupported_mime_type({ mimeType: input.file.mimeType }),
    )
  }
  if (input.file.buffer.byteLength > MAX_SIZE_BYTES) {
    throw new AssetValidationError(m.server_file_exceeds_20mb())
  }

  let width: number | null = null
  let height: number | null = null
  if (RASTER_MIMES.has(mimeType)) {
    const meta = await sharp(input.file.buffer).metadata()
    width = meta.width ?? null
    height = meta.height ?? null
  }

  const ext = EXT_BY_MIME[mimeType] ?? 'bin'
  const storageKey = `${input.organizationId}/${crypto.randomUUID()}.${ext}`
  const storage = getStorage()
  await storage.put(storageKey, input.file.buffer, mimeType)

  const [row] = await db
    .insert(asset)
    .values({
      organizationId: input.organizationId,
      storageKey,
      originalFilename: input.file.filename,
      mimeType,
      size: input.file.buffer.byteLength,
      width,
      height,
      altText: input.altText,
      createdBy: input.actorId,
    })
    .returning()

  if (!row) {
    throw new Error(m.server_failed_to_insert_asset())
  }
  return row
}

export async function listAssets(
  organizationId: string,
  opts: { search?: string; limit: number; offset: number },
): Promise<Asset[]> {
  const search = opts.search?.trim()
  return db
    .select()
    .from(asset)
    .where(
      search
        ? and(
            eq(asset.organizationId, organizationId),
            or(
              ilike(asset.originalFilename, `%${search}%`),
              ilike(asset.altText, `%${search}%`),
            ),
          )
        : eq(asset.organizationId, organizationId),
    )
    .orderBy(desc(asset.createdAt))
    .limit(opts.limit)
    .offset(opts.offset)
}

export async function getAsset(id: string): Promise<Asset | undefined> {
  const [row] = await db.select().from(asset).where(eq(asset.id, id)).limit(1)
  return row
}

export async function updateAsset(
  id: string,
  patch: { altText: string },
): Promise<Asset> {
  const [row] = await db
    .update(asset)
    .set({ altText: patch.altText })
    .where(eq(asset.id, id))
    .returning()
  if (!row) {
    throw new Error(m.server_asset_not_found())
  }
  return row
}

export async function assetUsage(id: string): Promise<number> {
  const pattern = `%${id}%`
  const [row] = await db
    .select({
      count: sql<number>`cast(count(*) as int)`,
    })
    .from(entry)
    .where(
      sql`${entry.draftData}::text LIKE ${pattern} OR ${entry.publishedData}::text LIKE ${pattern}`,
    )
  return Number(row?.count ?? 0)
}

export async function deleteAsset(id: string): Promise<void> {
  const existing = await getAsset(id)
  if (!existing) {
    throw new Error(m.server_asset_not_found())
  }
  const usage = await assetUsage(id)
  if (usage > 0) {
    throw new AssetInUseError(usage)
  }
  await getStorage().delete(existing.storageKey)
  await db.delete(asset).where(eq(asset.id, id))
}

export function assetUrl(assetRow: Pick<Asset, 'storageKey'>): string {
  return `${env.APP_URL}/api/assets/file/${assetRow.storageKey}`
}

export async function resolveAssetValue(
  assetId: string,
): Promise<ResolvedAssetValue | null> {
  const row = await getAsset(assetId)
  if (!row) return null
  return {
    url: assetUrl(row),
    width: row.width,
    height: row.height,
    alt: row.altText ?? '',
    mimeType: row.mimeType,
  }
}

export function storageKeyFromRequest(request: Request): string | undefined {
  const pathname = new URL(request.url).pathname
  if (!pathname.startsWith(ASSET_FILE_PREFIX)) return undefined
  const remainder = pathname.slice(ASSET_FILE_PREFIX.length)
  if (!remainder) return undefined
  try {
    return decodeURIComponent(remainder)
  } catch {
    return remainder
  }
}

function mimeFromExtension(storageKey: string): string | undefined {
  const dot = storageKey.lastIndexOf('.')
  if (dot < 0) return undefined
  return MIME_BY_EXT[storageKey.slice(dot + 1).toLowerCase()]
}

function realMediaType(value: string | undefined): string | undefined {
  const mime = value?.split(';')[0]?.trim().toLowerCase()
  if (!mime) return undefined
  if (ALLOWED_MIMES.has(mime) || mime.startsWith('image/')) return mime
  return undefined
}

export async function streamAssetFile(storageKey: string): Promise<Response> {
  const object = await getStorage().get(storageKey)
  if (!object) {
    return new Response(m.server_not_found(), { status: 404 })
  }

  const [row] = await db
    .select({ mimeType: asset.mimeType })
    .from(asset)
    .where(eq(asset.storageKey, storageKey))
    .limit(1)

  const contentType =
    realMediaType(row?.mimeType) ??
    realMediaType(object.contentType) ??
    mimeFromExtension(storageKey) ??
    'application/octet-stream'

  const body = Buffer.isBuffer(object.body)
    ? new Uint8Array(object.body)
    : object.body

  const headers: Record<string, string> = {
    'Content-Type': contentType,
    'Cache-Control': 'public, max-age=31536000, immutable',
    'Access-Control-Allow-Origin': '*',
    'Cross-Origin-Resource-Policy': 'cross-origin',
  }
  if (realMediaType(contentType)) {
    headers['X-Content-Type-Options'] = 'nosniff'
  }

  return new Response(body, { headers })
}
