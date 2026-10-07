import { and, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm'
import type { AnyColumn, InferSelectModel, SQL } from 'drizzle-orm'
import sharp from 'sharp'

import { getStorage } from '#/adapters'
import { db } from '#/db'
import {
  asset,
  deletedContentArchive,
  entry,
  entryRevision,
  publication,
  site,
  storageObjectDeletion,
} from '#/db/schema'
import { env } from '#/env'
import { m } from '#/paraglide/messages'
import { NotFoundError } from '#/server/content/errors'
import { AppError } from '#/server/http/app-error'

import { assetMutationLock, referencesAsset } from './usage'
import type { AssetTransaction } from './usage'

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

export class AssetValidationError extends AppError {
  constructor(message: string) {
    super(message)
    this.name = 'AssetValidationError'
  }
}

export class AssetInUseError extends AppError {
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

  try {
    return await db.transaction(async (tx) => {
      await assetMutationLock(tx, input.organizationId)
      const [row] = await tx
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
      if (!row) throw new Error(m.server_failed_to_insert_asset())
      return row
    })
  } catch (error) {
    try {
      await storage.delete(storageKey)
    } catch (cleanupError) {
      // If the database is reachable again, persist cleanup for the operator retry.
      try {
        await db
          .insert(storageObjectDeletion)
          .values({ storageKey })
          .onConflictDoNothing()
      } catch {}
      throw new AggregateError(
        [error, cleanupError],
        `Upload failed; object cleanup required: ${storageKey}`,
      )
    }
    throw error
  }
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

export async function getAsset(
  id: string,
  organizationId: string,
  connection: Pick<typeof db, 'select'> = db,
): Promise<Asset | undefined> {
  const [row] = await connection
    .select()
    .from(asset)
    .where(and(eq(asset.id, id), eq(asset.organizationId, organizationId)))
    .limit(1)
  return row
}

export async function updateAsset(
  id: string,
  patch: { altText: string },
  organizationId: string,
): Promise<Asset> {
  const [row] = await db
    .update(asset)
    .set({ altText: patch.altText })
    .where(and(eq(asset.id, id), eq(asset.organizationId, organizationId)))
    .returning()
  if (!row) {
    throw new NotFoundError(m.server_asset_not_found())
  }
  return row
}

/**
 * SQL pre-filter for `referencesAsset`: keeps every row that could reference the
 * asset so only those rows are transferred and walked in memory. It is a strict
 * superset of the exact check:
 *  - exact ids, storage keys and `/api/assets/file/<key>` URLs all contain the
 *    asset id or the final path segment of the storage key;
 *  - values that only match after URL parsing or percent-decoding contain a
 *    `%` (decodeURIComponent) or, for stripped tab/newline, a JSON backslash.
 * If the key tail has unexpected characters the filter degrades to "all rows".
 */
function mayReferenceAsset(
  existing: Pick<Asset, 'id' | 'storageKey'>,
  columns: AnyColumn[],
): SQL {
  const tail = existing.storageKey.slice(
    existing.storageKey.lastIndexOf('/') + 1,
  )
  if (
    !/^[A-Za-z0-9._-]+$/.test(tail) ||
    !/^[A-Za-z0-9._-]+$/.test(existing.id)
  ) {
    return sql`true`
  }
  // One regex per column: the jsonb -> text conversion is the expensive part.
  const escape = (value: string) => value.replace(/[.]/g, '\\.')
  const pattern = `${escape(existing.id)}|${escape(tail)}|%|\\\\`
  const conditions = columns.map((column) => sql`${column}::text ~ ${pattern}`)
  return or(...conditions) as SQL
}

async function retainedAssetUsage(
  tx: AssetTransaction,
  existing: Asset,
): Promise<number> {
  const organizationId = existing.organizationId
  const entries = await tx
    .select({
      draft: entry.draftData,
      published: entry.publishedData,
      scheduled: entry.scheduledData,
    })
    .from(entry)
    .innerJoin(site, eq(site.id, entry.siteId))
    .where(
      and(
        eq(site.organizationId, organizationId),
        mayReferenceAsset(existing, [
          entry.draftData,
          entry.publishedData,
          entry.scheduledData,
        ]),
      ),
    )
  const revisions = await tx
    .select({ data: entryRevision.data })
    .from(entryRevision)
    .innerJoin(entry, eq(entry.id, entryRevision.entryId))
    .innerJoin(site, eq(site.id, entry.siteId))
    .where(
      and(
        eq(site.organizationId, organizationId),
        mayReferenceAsset(existing, [entryRevision.data]),
      ),
    )
  const publications = await tx
    .select({ snapshot: publication.snapshot })
    .from(publication)
    .innerJoin(site, eq(site.id, publication.siteId))
    .where(
      and(
        eq(site.organizationId, organizationId),
        mayReferenceAsset(existing, [publication.snapshot]),
      ),
    )
  const archives = await tx
    .select({ data: deletedContentArchive.data })
    .from(deletedContentArchive)
    .where(
      and(
        eq(deletedContentArchive.organizationId, organizationId),
        mayReferenceAsset(existing, [deletedContentArchive.data]),
      ),
    )
  return [...entries, ...revisions, ...publications, ...archives].filter(
    (row) => referencesAsset(row, existing),
  ).length
}

export async function assetUsage(
  id: string,
  organizationId: string,
): Promise<number> {
  return db.transaction(async (tx) => {
    await assetMutationLock(tx, organizationId)
    const [existing] = await tx
      .select()
      .from(asset)
      .where(and(eq(asset.id, id), eq(asset.organizationId, organizationId)))
    return existing ? retainedAssetUsage(tx, existing) : 0
  })
}

/** Rows are removed first; the durable cleanup record keeps failed object deletes retryable. */
export async function deleteAsset(
  id: string,
  organizationId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    await assetMutationLock(tx, organizationId)
    const [existing] = await tx
      .select()
      .from(asset)
      .where(and(eq(asset.id, id), eq(asset.organizationId, organizationId)))
    if (!existing) throw new NotFoundError(m.server_asset_not_found())
    const usage = await retainedAssetUsage(tx, existing)
    if (usage > 0) throw new AssetInUseError(usage)
    await tx
      .insert(storageObjectDeletion)
      .values({ storageKey: existing.storageKey })
      .onConflictDoNothing()
    await tx.delete(asset).where(eq(asset.id, id))
  })
  await drainStorageObjectDeletions()
}

export async function drainStorageObjectDeletions(
  limit = 100,
): Promise<number> {
  const pending = await db.select().from(storageObjectDeletion).limit(limit)
  let removed = 0
  for (const item of pending) {
    try {
      await getStorage().delete(item.storageKey)
      await db
        .delete(storageObjectDeletion)
        .where(eq(storageObjectDeletion.storageKey, item.storageKey))
      removed++
    } catch (error) {
      await db
        .update(storageObjectDeletion)
        .set({
          lastError: error instanceof Error ? error.message : String(error),
        })
        .where(eq(storageObjectDeletion.storageKey, item.storageKey))
    }
  }
  return removed
}

export function assetUrl(assetRow: Pick<Asset, 'storageKey'>): string {
  return `${env.APP_URL}/api/assets/file/${assetRow.storageKey}`
}

function toResolvedAssetValue(row: Asset): ResolvedAssetValue {
  return {
    url: assetUrl(row),
    width: row.width,
    height: row.height,
    alt: row.altText ?? '',
    mimeType: row.mimeType,
  }
}

export async function resolveAssetValue(
  assetId: string,
  organizationId: string,
  connection: Pick<typeof db, 'select'> = db,
): Promise<ResolvedAssetValue | null> {
  const row = await getAsset(assetId, organizationId, connection)
  return row ? toResolvedAssetValue(row) : null
}

/**
 * Organization-scoped assets loaded in bulk, so a snapshot build resolves
 * thousands of references from memory instead of issuing one query each.
 */
export type AssetLookup = {
  byId: Map<string, Asset>
  byStorageKey: Map<string, Asset>
}

// Keep each statement well below PostgreSQL's 65,535 bind-parameter limit.
const LOOKUP_CHUNK = 5000

export async function loadAssetLookup(
  organizationId: string,
  refs: { ids: Iterable<string>; storageKeys: Iterable<string> },
  connection: Pick<typeof db, 'select'> = db,
): Promise<AssetLookup> {
  const lookup: AssetLookup = { byId: new Map(), byStorageKey: new Map() }
  const fetch = async (
    column: typeof asset.id | typeof asset.storageKey,
    values: string[],
  ) => {
    for (let i = 0; i < values.length; i += LOOKUP_CHUNK) {
      const rows = await connection
        .select()
        .from(asset)
        .where(
          and(
            eq(asset.organizationId, organizationId),
            inArray(column, values.slice(i, i + LOOKUP_CHUNK)),
          ),
        )
      for (const row of rows) {
        lookup.byId.set(row.id, row)
        lookup.byStorageKey.set(row.storageKey, row)
      }
    }
  }
  await fetch(asset.id, [...new Set(refs.ids)])
  await fetch(asset.storageKey, [...new Set(refs.storageKeys)])
  return lookup
}

export function resolveAssetFromLookup(
  lookup: AssetLookup,
  assetId: string,
): ResolvedAssetValue | null {
  const row = lookup.byId.get(assetId)
  return row ? toResolvedAssetValue(row) : null
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
