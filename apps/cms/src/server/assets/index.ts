import { and, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm'
import type { InferSelectModel } from 'drizzle-orm'

import { getStorage } from '#/adapters'
import { isValidLogicalKey } from '#/adapters/storage/s3-namespace.mjs'
import { db } from '#/db'
import type { DbReader, Tx } from '#/db'
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
import { audit } from '#/server/audit'

import {
  assetAttachLock,
  assetExclusiveLock,
  mayReferenceAssets,
  referencesAsset,
} from './usage'
import { derivedStorageKeys } from './derived'
import { AssetValidationError } from './errors'
import { validateImageBytes } from './image-validation'
import { missingAltFilter } from './missing-alt'
import {
  beginObjectUpload,
  completeObjectUpload,
  compensateObjectUpload,
  drainStorageObjectDeletions,
} from './storage-cleanup'

export { AssetValidationError } from './errors'
export { drainStorageObjectDeletions } from './storage-cleanup'

export type Asset = InferSelectModel<typeof asset>

/** Who changed an asset, for its audit row. `siteId` is the site it was changed from, if any. */
export type AssetActor = { actorId: string; siteId?: string | null }

function auditAsset(
  tx: Tx,
  action: 'asset.update' | 'asset.delete',
  row: Asset,
  by: AssetActor,
) {
  return audit(
    {
      organizationId: row.organizationId,
      siteId: by.siteId ?? null,
      actorId: by.actorId,
      action,
      targetType: 'asset',
      targetId: row.id,
      meta: { filename: row.originalFilename },
    },
    tx,
  )
}

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

export const MAX_SIZE_BYTES = 20 * 1024 * 1024

export class AssetInUseError extends AppError {
  constructor(public readonly usage: number) {
    super(m.server_asset_in_use({ usage: String(usage) }))
    this.name = 'AssetInUseError'
  }
}

export async function uploadAsset(input: {
  organizationId: string
  file: { buffer: Buffer; filename: string; mimeType: string }
  /** Null for system jobs such as the external image backfill. */
  actorId: string | null
  altText?: string
  originSiteId?: string
  sourceUrl?: string
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
    const meta = await validateImageBytes(input.file.buffer, mimeType)
    width = meta.width ?? null
    height = meta.height ?? null
  }

  const ext = EXT_BY_MIME[mimeType] ?? 'bin'
  const storageKey = `${input.organizationId}/${crypto.randomUUID()}.${ext}`
  const storage = getStorage()
  await beginObjectUpload(storageKey)
  try {
    await storage.put(storageKey, input.file.buffer, mimeType)
    return await db.transaction(async (tx) => {
      await assetAttachLock(tx, input.organizationId)
      const row = (
        await tx
          .insert(asset)
          .values({
            organizationId: input.organizationId,
            originSiteId: input.originSiteId,
            storageKey,
            originalFilename: input.file.filename,
            mimeType,
            size: input.file.buffer.byteLength,
            width,
            height,
            altText: input.altText,
            sourceUrl: input.sourceUrl,
            createdBy: input.actorId,
          })
          .returning()
      ).at(0)
      if (!row) throw new Error(m.server_failed_to_insert_asset())
      await completeObjectUpload(tx, storageKey)
      return row
    })
  } catch (error) {
    try {
      await compensateObjectUpload(storageKey)
    } catch (cleanupError) {
      // The upload intent remains durable even if the database is temporarily
      // unreachable; the maintenance loop will pick it up after recovery.
      throw new AggregateError(
        [error, cleanupError],
        'Upload failed; object cleanup is queued',
      )
    }
    throw error
  }
}

export async function listAssets(
  organizationId: string,
  opts: {
    search?: string
    limit: number
    offset: number
    imagesOnly?: boolean
    /** Only images without a description in this content language. */
    missingAlt?: { locale: string | null; mainLocale: string | null }
  },
): Promise<Asset[]> {
  const search = opts.search?.trim()
  return db
    .select()
    .from(asset)
    .where(
      and(
        eq(asset.organizationId, organizationId),
        opts.imagesOnly
          ? inArray(asset.mimeType, [...RASTER_MIMES])
          : undefined,
        opts.missingAlt
          ? missingAltFilter(opts.missingAlt.locale, opts.missingAlt.mainLocale)
          : undefined,
        search
          ? or(
              ilike(asset.originalFilename, `%${search}%`),
              ilike(asset.altText, `%${search}%`),
            )
          : undefined,
      ),
    )
    .orderBy(desc(asset.createdAt), desc(asset.id))
    .limit(opts.limit)
    .offset(opts.offset)
}

export async function getAsset(
  id: string,
  organizationId: string,
  connection: DbReader = db,
): Promise<Asset | undefined> {
  const [row] = await connection
    .select()
    .from(asset)
    .where(and(eq(asset.id, id), eq(asset.organizationId, organizationId)))
    .limit(1)
  return row
}

/**
 * Sets the alt text. Without `locale`, or with the site's main language, this
 * is `alt`. Any other language is `altI18n[locale]`; an empty value removes
 * that language's alt, so the site falls back to the main alt.
 */
export async function updateAsset(
  id: string,
  patch: {
    altText: string
    locale?: string | null
    mainLocale?: string | null
  },
  organizationId: string,
  by?: AssetActor,
): Promise<Asset> {
  const translation =
    patch.locale && patch.locale !== patch.mainLocale ? patch.locale : null
  return db.transaction(async (tx) => {
    const row = (
      await tx
        .update(asset)
        .set(
          translation
            ? {
                altI18n:
                  patch.altText.trim() === ''
                    ? sql`${asset.altI18n} - ${translation}::text`
                    : sql`jsonb_set(${asset.altI18n}, ARRAY[${translation}::text], to_jsonb(${patch.altText}::text), true)`,
              }
            : { altText: patch.altText },
        )
        .where(and(eq(asset.id, id), eq(asset.organizationId, organizationId)))
        .returning()
    ).at(0)
    if (!row) {
      throw new NotFoundError(m.server_asset_not_found())
    }
    if (by) await auditAsset(tx, 'asset.update', row, by)
    return row
  })
}

async function retainedAssetUsage(tx: Tx, existing: Asset): Promise<number> {
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
        mayReferenceAssets(
          [existing],
          [entry.draftData, entry.publishedData, entry.scheduledData],
        ),
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
        mayReferenceAssets([existing], [entryRevision.data]),
      ),
    )
  const publications = await tx
    .select({ snapshot: publication.snapshot })
    .from(publication)
    .innerJoin(site, eq(site.id, publication.siteId))
    .where(
      and(
        eq(site.organizationId, organizationId),
        mayReferenceAssets([existing], [publication.snapshot]),
      ),
    )
  const archives = await tx
    .select({ data: deletedContentArchive.data })
    .from(deletedContentArchive)
    .where(
      and(
        eq(deletedContentArchive.organizationId, organizationId),
        mayReferenceAssets([existing], [deletedContentArchive.data]),
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
  // A count to show, not a delete check: no asset lock, so it never waits for
  // or blocks saves. One snapshot keeps the four reads consistent.
  return db.transaction(
    async (tx) => {
      const existing = (
        await tx
          .select()
          .from(asset)
          .where(
            and(eq(asset.id, id), eq(asset.organizationId, organizationId)),
          )
      ).at(0)
      return existing ? retainedAssetUsage(tx, existing) : 0
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  )
}

/** Rows are removed first; the durable cleanup record keeps failed object deletes retryable. */
export async function deleteAsset(
  id: string,
  organizationId: string,
  by?: AssetActor,
): Promise<void> {
  await db.transaction(async (tx) => {
    await assetExclusiveLock(tx, organizationId)
    const existing = (
      await tx
        .select()
        .from(asset)
        .where(and(eq(asset.id, id), eq(asset.organizationId, organizationId)))
    ).at(0)
    if (!existing) throw new NotFoundError(m.server_asset_not_found())
    const usage = await retainedAssetUsage(tx, existing)
    if (usage > 0) throw new AssetInUseError(usage)
    await tx
      .insert(storageObjectDeletion)
      .values(
        [existing.storageKey, ...derivedStorageKeys(existing.storageKey)].map(
          (storageKey) => ({ storageKey }),
        ),
      )
      .onConflictDoNothing()
    await tx.delete(asset).where(eq(asset.id, id))
    if (by) await auditAsset(tx, 'asset.delete', existing, by)
  })
  await drainStorageObjectDeletions()
}

export function assetUrl(assetRow: Pick<Asset, 'storageKey'>): string {
  return `${env.APP_URL}/api/assets/file/${assetRow.storageKey}`
}

/**
 * Alt text for a language: the translation when it is set, else the main
 * alt. Without a locale this is the main alt.
 */
function altFor(row: Asset, locale?: string | null): string {
  const translated = locale ? row.altI18n[locale] : undefined
  return translated || row.altText || ''
}

function toResolvedAssetValue(
  row: Asset,
  locale?: string | null,
): ResolvedAssetValue {
  return {
    url: assetUrl(row),
    width: row.width,
    height: row.height,
    alt: altFor(row, locale),
    mimeType: row.mimeType,
  }
}

export async function resolveAssetValue(
  assetId: string,
  organizationId: string,
  connection: DbReader = db,
  locale?: string | null,
): Promise<ResolvedAssetValue | null> {
  const row = await getAsset(assetId, organizationId, connection)
  return row ? toResolvedAssetValue(row, locale) : null
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
  connection: DbReader = db,
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
  locale?: string | null,
): ResolvedAssetValue | null {
  const row = lookup.byId.get(assetId)
  return row ? toResolvedAssetValue(row, locale) : null
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
  if (!isValidLogicalKey(storageKey)) {
    return new Response(m.server_not_found(), { status: 404 })
  }
  const object = await getStorage().get(storageKey)
  if (!object) {
    return new Response(m.server_not_found(), { status: 404 })
  }

  const row = (
    await db
      .select({ mimeType: asset.mimeType })
      .from(asset)
      .where(eq(asset.storageKey, storageKey))
      .limit(1)
  ).at(0)

  const contentType =
    realMediaType(row?.mimeType) ??
    realMediaType(object.contentType) ??
    mimeFromExtension(storageKey) ??
    'application/octet-stream'

  // The bytes stream from storage straight to the client; nothing is buffered
  // in memory here.
  const headers: Record<string, string> = {
    'Content-Type': contentType,
    'Cache-Control': 'public, max-age=31536000, immutable',
    'Access-Control-Allow-Origin': '*',
    'Cross-Origin-Resource-Policy': 'cross-origin',
  }
  if (object.contentLength !== undefined) {
    headers['Content-Length'] = String(object.contentLength)
  }
  if (realMediaType(contentType)) {
    headers['X-Content-Type-Options'] = 'nosniff'
  }

  return new Response(object.body, { headers })
}
