import { randomBytes } from 'node:crypto'

import { and, asc, eq, gt, isNull, lt, sql } from 'drizzle-orm'

import { db } from '#/db'
import {
  asset,
  assetUploadSession,
  assetUploadSessionFile,
  mcpConnection,
  mcpKey,
  site,
  user,
} from '#/db/schema'
import { env } from '#/env'
import { m } from '#/paraglide/messages'
import { audit } from '#/server/audit'
import { AppError } from '#/server/http/app-error'
import { liveRoleFor } from '#/server/mcp/keys'
import { hashToken } from '#/server/security/token-hash'

import { AssetValidationError } from './errors'
import { MAX_SIZE_BYTES, uploadAsset } from './index'
import type { Asset } from './index'
import { cleanFilename, sniffMimeType } from './remote'

/** A session takes new uploads for this long after it is created. */
export const UPLOAD_SESSION_TTL_MS = 20 * 60 * 1000
export const UPLOAD_SESSION_MAX_FILES = 20
export const UPLOAD_PURPOSE_MAX_LENGTH = 200
export const UPLOAD_TOKEN_PREFIX = 'areca_up_'
/** Old sessions are deleted a day after they expire; their assets stay. */
const PRUNE_AFTER_MS = 24 * 60 * 60 * 1000
const TOKEN_BYTES = 32

export type UploadSession = typeof assetUploadSession.$inferSelect
export type UploadSessionState = 'open' | 'finished' | 'expired'

export type UploadSessionErrorCode =
  'not_found' | 'expired' | 'finished' | 'full'

const ERROR_MESSAGES: Record<UploadSessionErrorCode, string> = {
  not_found:
    'This upload link is not valid. Ask the AI assistant for a new one.',
  expired: 'This upload link has expired. Ask the AI assistant for a new one.',
  finished:
    'This upload link was already used and is closed. Ask the AI assistant for a new one.',
  full: `This upload link already has ${UPLOAD_SESSION_MAX_FILES} files, the most one link takes. Ask the AI assistant for a new one.`,
}

const ERROR_STATUS: Record<UploadSessionErrorCode, number> = {
  not_found: 404,
  expired: 410,
  finished: 410,
  full: 409,
}

/** Why a session refused an upload. `code` is stable; the page translates it. */
export class UploadSessionError extends AppError {
  readonly status: number
  constructor(readonly code: UploadSessionErrorCode) {
    super(ERROR_MESSAGES[code])
    this.name = 'UploadSessionError'
    this.status = ERROR_STATUS[code]
  }
}

export function sessionState(
  row: Pick<UploadSession, 'finishedAt' | 'expiresAt'>,
  now: Date = new Date(),
): UploadSessionState {
  if (row.finishedAt) return 'finished'
  if (row.expiresAt.getTime() <= now.getTime()) return 'expired'
  return 'open'
}

/** The page a person opens, and the address a shell uploads to (`curl -T file <uploadUrl>/`). */
export function uploadSessionUrls(token: string) {
  return {
    pageUrl: `${env.APP_URL}/upload/${token}`,
    uploadUrl: `${env.APP_URL}/api/upload/${token}`,
  }
}

export async function createUploadSession(
  input: {
    organizationId: string
    siteId: string
    userId: string
    /** The MCP credential opening the session; uploads stop when it is revoked. */
    credential?: { kind: 'key' | 'oauth'; id: string } | null
    purpose?: string | null
  },
  now: Date = new Date(),
): Promise<{ session: UploadSession; token: string }> {
  await db
    .delete(assetUploadSession)
    .where(
      lt(
        assetUploadSession.expiresAt,
        new Date(now.getTime() - PRUNE_AFTER_MS),
      ),
    )
  const token = `${UPLOAD_TOKEN_PREFIX}${randomBytes(TOKEN_BYTES).toString('base64url')}`
  const purpose = input.purpose?.trim().slice(0, UPLOAD_PURPOSE_MAX_LENGTH)
  const session = (
    await db
      .insert(assetUploadSession)
      .values({
        tokenHash: hashToken(token),
        organizationId: input.organizationId,
        siteId: input.siteId,
        userId: input.userId,
        mcpKeyId: input.credential?.kind === 'key' ? input.credential.id : null,
        mcpConnectionId:
          input.credential?.kind === 'oauth' ? input.credential.id : null,
        purpose: purpose || null,
        maxFiles: UPLOAD_SESSION_MAX_FILES,
        expiresAt: new Date(now.getTime() + UPLOAD_SESSION_TTL_MS),
        createdAt: now,
      })
      .returning()
  ).at(0)
  if (!session) throw new Error('Failed to create the upload session')
  return { session, token }
}

export async function findSessionByToken(
  token: string,
): Promise<UploadSession | null> {
  if (!token.startsWith(UPLOAD_TOKEN_PREFIX)) return null
  const row = (
    await db
      .select()
      .from(assetUploadSession)
      .where(eq(assetUploadSession.tokenHash, hashToken(token)))
      .limit(1)
  ).at(0)
  return row ?? null
}

/** A session the AI opened, looked up by id for the same person on the same site. */
export async function findSessionForActor(
  id: string,
  actor: { siteId: string; userId: string },
): Promise<UploadSession | null> {
  const row = (
    await db
      .select()
      .from(assetUploadSession)
      .where(
        and(
          eq(assetUploadSession.id, id),
          eq(assetUploadSession.siteId, actor.siteId),
          eq(assetUploadSession.userId, actor.userId),
        ),
      )
      .limit(1)
  ).at(0)
  return row ?? null
}

export async function sessionAssets(sessionId: string): Promise<Asset[]> {
  const rows = await db
    .select({ asset })
    .from(assetUploadSessionFile)
    .innerJoin(asset, eq(asset.id, assetUploadSessionFile.assetId))
    .where(eq(assetUploadSessionFile.sessionId, sessionId))
    .orderBy(asc(assetUploadSessionFile.createdAt), asc(asset.createdAt))
  return rows.map((row) => row.asset)
}

/** Closes the session at once. Uploads already under way still complete. */
export async function finishSession(
  sessionId: string,
  now: Date = new Date(),
): Promise<UploadSession> {
  await db
    .update(assetUploadSession)
    .set({ finishedAt: now })
    .where(
      and(
        eq(assetUploadSession.id, sessionId),
        isNull(assetUploadSession.finishedAt),
      ),
    )
  const row = (
    await db
      .select()
      .from(assetUploadSession)
      .where(eq(assetUploadSession.id, sessionId))
      .limit(1)
  ).at(0)
  if (!row) throw new UploadSessionError('not_found')
  return row
}

/** Takes one file slot, or says why the session cannot take another file. */
async function reserveSlot(session: UploadSession, now: Date): Promise<void> {
  const reserved = (
    await db
      .update(assetUploadSession)
      .set({ reservedCount: sql`${assetUploadSession.reservedCount} + 1` })
      .where(
        and(
          eq(assetUploadSession.id, session.id),
          isNull(assetUploadSession.finishedAt),
          gt(assetUploadSession.expiresAt, now),
          lt(assetUploadSession.reservedCount, assetUploadSession.maxFiles),
        ),
      )
      .returning({ id: assetUploadSession.id })
  ).at(0)
  if (reserved) return
  const state = sessionState(session, now)
  if (state !== 'open') throw new UploadSessionError(state)
  // Re-read: another request may have just finished or filled the session.
  const current = (
    await db
      .select()
      .from(assetUploadSession)
      .where(eq(assetUploadSession.id, session.id))
      .limit(1)
  ).at(0)
  if (!current) throw new UploadSessionError('not_found')
  const currentState = sessionState(current, now)
  throw new UploadSessionError(currentState === 'open' ? 'full' : currentState)
}

async function releaseSlot(sessionId: string): Promise<void> {
  await db
    .update(assetUploadSession)
    .set({ reservedCount: sql`${assetUploadSession.reservedCount} - 1` })
    .where(
      and(
        eq(assetUploadSession.id, sessionId),
        gt(assetUploadSession.reservedCount, 0),
      ),
    )
}

/**
 * Whether the MCP key or OAuth connection that opened the session is still
 * active. A deleted one has already deleted the session (foreign key cascade).
 */
async function credentialStillActive(
  session: UploadSession,
  now: Date,
): Promise<boolean> {
  if (session.mcpKeyId) {
    const key = (
      await db
        .select({ revokedAt: mcpKey.revokedAt, expiresAt: mcpKey.expiresAt })
        .from(mcpKey)
        .where(eq(mcpKey.id, session.mcpKeyId))
        .limit(1)
    ).at(0)
    return (
      !!key &&
      !key.revokedAt &&
      (!key.expiresAt || key.expiresAt.getTime() > now.getTime())
    )
  }
  if (session.mcpConnectionId) {
    const connection = (
      await db
        .select({ revokedAt: mcpConnection.revokedAt })
        .from(mcpConnection)
        .where(eq(mcpConnection.id, session.mcpConnectionId))
        .limit(1)
    ).at(0)
    return !!connection && !connection.revokedAt
  }
  return true
}

/**
 * The person who opened the session must still have access to the site's
 * client, and the credential they opened it with must still be active: a
 * removed or blocked member's link, or one from a revoked key or connection,
 * stops working at once.
 */
async function assertOwnerStillHasAccess(session: UploadSession, now: Date) {
  const owner = (
    await db
      .select({
        id: user.id,
        isAgencyAdmin: user.isAgencyAdmin,
        twoFactorEnabled: user.twoFactorEnabled,
        blockedAt: user.blockedAt,
      })
      .from(user)
      .where(eq(user.id, session.userId))
      .limit(1)
  ).at(0)
  const siteRow = (
    await db
      .select({ id: site.id })
      .from(site)
      .where(eq(site.id, session.siteId))
      .limit(1)
  ).at(0)
  if (!owner || !siteRow) throw new UploadSessionError('not_found')
  const access = await liveRoleFor(owner, session.organizationId)
  if (!access.ok) throw new UploadSessionError('not_found')
  if (!(await credentialStillActive(session, now))) {
    throw new UploadSessionError('not_found')
  }
}

export type SessionUploadResult = {
  session: UploadSession
  asset: Asset
  /** Files saved through this session so far, this one included. */
  uploaded: number
}

/**
 * Saves one file sent to an upload link. The bytes decide the type (the
 * declared Content-Type is not trusted), and the usual library checks apply.
 * The file counts against the session only once it is saved.
 */
export async function uploadToSession(
  input: {
    token: string
    /** Reads the body; called only after the session has a free slot. */
    readBytes: () => Promise<Uint8Array>
    filename?: string | null
  },
  now: Date = new Date(),
): Promise<SessionUploadResult> {
  const session = await findSessionByToken(input.token)
  if (!session) throw new UploadSessionError('not_found')
  const state = sessionState(session, now)
  if (state !== 'open') throw new UploadSessionError(state)
  await assertOwnerStillHasAccess(session, now)

  await reserveSlot(session, now)
  let saved: Asset | null = null
  try {
    const bytes = Buffer.from(await input.readBytes())
    if (bytes.byteLength === 0) {
      throw new AssetValidationError(
        'The upload was empty. Send the file bytes as the request body.',
      )
    }
    if (bytes.byteLength > MAX_SIZE_BYTES) {
      throw new AssetValidationError(m.server_file_exceeds_20mb())
    }
    const mimeType = sniffMimeType(bytes)
    if (!mimeType) {
      throw new AssetValidationError(m.server_remote_unsupported_file())
    }
    const filename =
      cleanFilename(input.filename, mimeType) ??
      cleanFilename('upload', mimeType) ??
      'upload'
    saved = await uploadAsset({
      organizationId: session.organizationId,
      originSiteId: session.siteId,
      file: { buffer: bytes, filename, mimeType },
      actorId: session.userId,
    })
    await db.insert(assetUploadSessionFile).values({
      sessionId: session.id,
      assetId: saved.id,
      createdAt: new Date(),
    })
    await audit({
      organizationId: session.organizationId,
      siteId: session.siteId,
      actorId: session.userId,
      action: 'asset.upload',
      targetType: 'asset',
      targetId: saved.id,
      meta: {
        filename: saved.originalFilename,
        via: 'upload-link',
        uploadSessionId: session.id,
      },
    })
  } catch (error) {
    if (!saved) await releaseSlot(session.id)
    throw error
  }
  const countRow = (
    await db
      .select({ count: sql<number>`count(*)::int` })
      .from(assetUploadSessionFile)
      .where(eq(assetUploadSessionFile.sessionId, session.id))
  ).at(0)
  const count = countRow?.count ?? 0
  return { session, asset: saved, uploaded: count }
}

/** What the upload page shows before anything is sent. */
export async function publicSessionInfo(
  token: string,
  now: Date = new Date(),
): Promise<{
  state: UploadSessionState
  purpose: string | null
  siteName: string
  expiresAt: string
  maxFiles: number
  uploaded: number
  maxFileBytes: number
} | null> {
  const session = await findSessionByToken(token)
  if (!session || !(await credentialStillActive(session, now))) return null
  const siteRow = (
    await db
      .select({ name: site.name })
      .from(site)
      .where(eq(site.id, session.siteId))
      .limit(1)
  ).at(0)
  if (!siteRow) return null
  const countRow = (
    await db
      .select({ count: sql<number>`count(*)::int` })
      .from(assetUploadSessionFile)
      .where(eq(assetUploadSessionFile.sessionId, session.id))
  ).at(0)
  const count = countRow?.count ?? 0
  return {
    state: sessionState(session, now),
    purpose: session.purpose,
    siteName: siteRow.name,
    expiresAt: session.expiresAt.toISOString(),
    maxFiles: session.maxFiles,
    uploaded: count,
    maxFileBytes: MAX_SIZE_BYTES,
  }
}

/** Finishes a session from its link (the page's last step). */
export async function finishSessionByToken(
  token: string,
  now: Date = new Date(),
): Promise<UploadSession> {
  const session = await findSessionByToken(token)
  if (!session) throw new UploadSessionError('not_found')
  if (sessionState(session, now) === 'expired') {
    throw new UploadSessionError('expired')
  }
  await assertOwnerStillHasAccess(session, now)
  return finishSession(session.id, now)
}
