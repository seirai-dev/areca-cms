/* eslint-disable @typescript-eslint/no-unnecessary-condition -- row lookups after .returning()/.select() are checked defensively */
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm'

import { Pool } from 'pg'

import { db, pool } from '#/db'
import { registerPool } from '#/db/pool-registry'
import { createSessionLock } from '#/db/session-lock'
import {
  mcpConnection,
  oauthAccessToken,
  oauthConsent,
  oauthRefreshToken,
  user,
  site,
} from '#/db/schema'
import type { McpScope } from '#/db/schema'
import { m } from '#/paraglide/messages'
import { createLogger } from '#/server/log'
import { audit } from '#/server/audit'
import { NotFoundError } from '#/server/content/errors'

import { MCP_CONNECTION_IDLE_MS } from './oauth-resource'

const LAST_USED_WRITE_INTERVAL_MS = 60_000
// Locks use a separate small pool: waiting approvals cannot exhaust the data
// pool while the lock holder's OAuth handler needs a connection to finish.
const grantLockPool = new Pool({ ...pool.options, max: 4 })
grantLockPool.on('error', (error) =>
  createLogger('mcp-grants').error('Grant lock connection failed', {
    err: error,
  }),
)
registerPool('mcp', grantLockPool)
const withGrantLock = createSessionLock(grantLockPool)

export type McpConnectionRow = typeof mcpConnection.$inferSelect

export type McpConnectionSummary = {
  id: string
  clientId: string
  clientName: string
  userId: string
  userName: string | null
  allowGoLive: boolean
  createdAt: Date
  lastUsedAt: Date | null
}

/**
 * A connection works while it is not revoked and was used (or created) within
 * the idle window. The refresh token expires on the same schedule, so this
 * check mostly matters for access tokens that are still within their hour.
 */
export function isConnectionUsable(
  row: Pick<McpConnectionRow, 'revokedAt' | 'lastUsedAt' | 'createdAt'>,
  now: Date = new Date(),
): boolean {
  if (row.revokedAt) return false
  const lastActive = row.lastUsedAt ?? row.createdAt
  return now.getTime() - lastActive.getTime() <= MCP_CONNECTION_IDLE_MS
}

/**
 * Records that `userId` connected `clientId` to a site. One active connection
 * per (user, site, app): approving again updates the name and go-live flag.
 */
export async function upsertConnection(input: {
  userId: string
  siteId: string
  organizationId: string
  clientId: string
  clientName: string
  allowGoLive: boolean
  now?: Date
}): Promise<McpConnectionRow> {
  return withConnectionLock(input, async () => {
    const now = input.now ?? new Date()
    const existing = await findUsableConnection({ ...input, now })
    return saveConnectionApproval(
      input,
      existing?.id ?? crypto.randomUUID(),
      now,
    )
  })
}

/** Serialize approval and disconnect for the same grant across processes. */
export function withConnectionLock<T>(
  input: { userId: string; siteId: string | null; clientId: string },
  run: () => Promise<T>,
): Promise<T> {
  return withGrantLock(
    JSON.stringify([input.userId, input.siteId, input.clientId]),
    run,
  )
}

/**
 * Called under the tuple lock, after OAuth consent has completed. A null
 * `siteId` is an agency approval (scope 'agency'); it has no organization.
 */
export async function saveConnectionApproval(
  input: {
    userId: string
    siteId: string | null
    organizationId: string | null
    clientId: string
    clientName: string
    allowGoLive: boolean
  },
  id: string,
  now: Date = new Date(),
): Promise<McpConnectionRow> {
  const clientName = input.clientName.trim() || 'AI app'
  const scope: McpScope = input.siteId === null ? 'agency' : 'site'
  const row = await db.transaction(async (tx) => {
    // A new generation retires an idle connection instead of reviving its old tokens.
    const retired = await tx
      .update(mcpConnection)
      .set({ revokedAt: now })
      .where(
        and(
          eq(mcpConnection.userId, input.userId),
          input.siteId === null
            ? eq(mcpConnection.scope, 'agency')
            : eq(mcpConnection.siteId, input.siteId),
          eq(mcpConnection.clientId, input.clientId),
          isNull(mcpConnection.revokedAt),
          sql`${mcpConnection.id} <> ${id}`,
        ),
      )
      .returning()
    for (const previous of retired) {
      await revokeGenerationTokens(tx, previous, connectionRefs(previous), now)
      await tx
        .delete(oauthConsent)
        .where(
          and(
            eq(oauthConsent.userId, previous.userId),
            eq(oauthConsent.clientId, previous.clientId),
            inArray(oauthConsent.referenceId, connectionRefs(previous)),
          ),
        )
    }
    const [saved] = await tx
      .insert(mcpConnection)
      .values({
        id,
        userId: input.userId,
        scope,
        siteId: input.siteId,
        clientId: input.clientId,
        clientName,
        allowGoLive: input.allowGoLive,
        createdAt: now,
      })
      .onConflictDoUpdate({
        target: mcpConnection.id,
        set: { clientName, allowGoLive: input.allowGoLive },
        setWhere: isNull(mcpConnection.revokedAt),
      })
      .returning()
    if (!saved) throw new Error('Connection was disconnected during approval')
    await audit(
      {
        organizationId: input.organizationId,
        siteId: input.siteId,
        actorId: input.userId,
        action: 'mcp_connection.create',
        targetType: 'mcp_connection',
        targetId: saved.id,
        meta: {
          clientName,
          allowGoLive: saved.allowGoLive,
          ...(scope === 'agency' ? { scope } : {}),
        },
      },
      tx,
    )
    return saved
  })
  return row
}

/** Usable connections for a site, newest first. Editors see their own only. */
export async function listConnections(input: {
  siteId: string
  userId: string
  includeAllUsers: boolean
  now?: Date
}): Promise<McpConnectionSummary[]> {
  const now = input.now ?? new Date()
  const rows = await db
    .select({ connection: mcpConnection, userName: user.name })
    .from(mcpConnection)
    .leftJoin(user, eq(user.id, mcpConnection.userId))
    .where(
      and(
        eq(mcpConnection.siteId, input.siteId),
        isNull(mcpConnection.revokedAt),
        input.includeAllUsers
          ? undefined
          : eq(mcpConnection.userId, input.userId),
      ),
    )
    .orderBy(desc(mcpConnection.createdAt))
  return rows
    .filter((row) => isConnectionUsable(row.connection, now))
    .map((row) => ({
      id: row.connection.id,
      clientId: row.connection.clientId,
      clientName: row.connection.clientName,
      userId: row.connection.userId,
      userName: row.userName ?? null,
      allowGoLive: row.connection.allowGoLive,
      createdAt: row.connection.createdAt,
      lastUsedAt: row.connection.lastUsedAt,
    }))
}

/**
 * Disconnects an app from a site immediately. The connection is revoked, the
 * consent for that (app, user, site) is removed, and every access and refresh
 * token issued for that site is revoked, so the next request is refused.
 */
export async function revokeConnection(input: {
  id: string
  siteId: string
  actorId: string
  organizationId: string
  canRevokeOthers: boolean
  now?: Date
}): Promise<void> {
  const [row] = await db
    .select()
    .from(mcpConnection)
    .where(
      and(
        eq(mcpConnection.id, input.id),
        eq(mcpConnection.siteId, input.siteId),
      ),
    )
    .limit(1)
  if (!row || (row.userId !== input.actorId && !input.canRevokeOthers)) {
    throw new NotFoundError(m.server_mcp_connection_not_found())
  }
  await revokeRow(row, {
    actorId: input.actorId,
    organizationId: input.organizationId,
    now: input.now,
  })
}

/**
 * Disconnects one of the caller's agency apps. Other people's connections
 * answer NotFound, like the per-site list does.
 */
export async function revokeAgencyConnection(input: {
  id: string
  actorId: string
  now?: Date
}): Promise<void> {
  const [row] = await db
    .select()
    .from(mcpConnection)
    .where(
      and(
        eq(mcpConnection.id, input.id),
        eq(mcpConnection.scope, 'agency'),
        eq(mcpConnection.userId, input.actorId),
      ),
    )
    .limit(1)
  if (!row) throw new NotFoundError(m.server_mcp_connection_not_found())
  await revokeRow(row, {
    actorId: input.actorId,
    organizationId: null,
    now: input.now,
  })
}

/** Revokes one connection, its consent and its tokens, under the grant lock. */
async function revokeRow(
  row: McpConnectionRow,
  input: { actorId: string; organizationId: string | null; now?: Date },
): Promise<void> {
  await withConnectionLock(row, async () => {
    const now = input.now ?? new Date()
    await db.transaction(async (tx) => {
      const [revoked] = await tx
        .update(mcpConnection)
        .set({ revokedAt: now })
        .where(
          and(eq(mcpConnection.id, row.id), isNull(mcpConnection.revokedAt)),
        )
        .returning()
      if (!revoked) return
      // Include legacy site references so deployment also invalidates pre-upgrade tokens.
      const refs = connectionRefs(row)
      await tx
        .delete(oauthConsent)
        .where(
          and(
            eq(oauthConsent.clientId, row.clientId),
            eq(oauthConsent.userId, row.userId),
            inArray(oauthConsent.referenceId, refs),
          ),
        )
      await revokeGenerationTokens(tx, row, refs, now)
      await audit(
        {
          organizationId: input.organizationId,
          siteId: row.siteId,
          actorId: input.actorId,
          action: 'mcp_connection.revoke',
          targetType: 'mcp_connection',
          targetId: row.id,
          meta: {
            clientName: row.clientName,
            allowGoLive: row.allowGoLive,
            ...(row.scope === 'agency' ? { scope: row.scope } : {}),
          },
        },
        tx,
      )
    })
  })
}

/**
 * Disconnects every app a user connected to the given sites, in the caller's
 * transaction (organization removal). Same effect as `revokeConnection`: the
 * connection, its consent and every token it issued are revoked.
 */
export async function revokeMemberMcpConnections(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  input: { userId: string; siteIds: string[]; now?: Date },
): Promise<number> {
  if (input.siteIds.length === 0) return 0
  const now = input.now ?? new Date()
  const revoked = await tx
    .update(mcpConnection)
    .set({ revokedAt: now })
    .where(
      and(
        eq(mcpConnection.userId, input.userId),
        inArray(mcpConnection.siteId, input.siteIds),
        isNull(mcpConnection.revokedAt),
      ),
    )
    .returning()
  for (const row of revoked) {
    await revokeConnectionTokens(tx, row, now)
  }
  return revoked.length
}

/**
 * Disconnects every agency app a user connected (the user lost the agency
 * admin role). Same effect as `revokeMemberMcpConnections`, for agency scope.
 */
export async function revokeAgencyMcpConnections(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  input: { userId: string; now?: Date },
): Promise<number> {
  const now = input.now ?? new Date()
  const revoked = await tx
    .update(mcpConnection)
    .set({ revokedAt: now })
    .where(
      and(
        eq(mcpConnection.userId, input.userId),
        eq(mcpConnection.scope, 'agency'),
        isNull(mcpConnection.revokedAt),
      ),
    )
    .returning()
  for (const row of revoked) {
    await revokeConnectionTokens(tx, row, now)
  }
  return revoked.length
}

/**
 * The reference ids a connection's consent and tokens may carry: the connection
 * itself, and for a site connection the site too (older rows named the site).
 */
export function connectionRefs(row: {
  id: string
  siteId: string | null
}): string[] {
  return row.siteId ? [row.id, row.siteId] : [row.id]
}

/** Consent and every token of one connection, in the caller's transaction. */
async function revokeConnectionTokens(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  row: Pick<McpConnectionRow, 'id' | 'siteId' | 'clientId' | 'userId'>,
  now: Date,
) {
  const refs = connectionRefs(row)
  await tx
    .delete(oauthConsent)
    .where(
      and(
        eq(oauthConsent.clientId, row.clientId),
        eq(oauthConsent.userId, row.userId),
        inArray(oauthConsent.referenceId, refs),
      ),
    )
  await revokeGenerationTokens(tx, row, refs, now)
}

/** Clear replay caches too: a disconnected rotated token must never return 200. */
async function revokeGenerationTokens(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  row: { clientId: string; userId: string },
  refs: string[],
  now: Date,
) {
  await tx
    .update(oauthAccessToken)
    .set({ revoked: now })
    .where(
      and(
        eq(oauthAccessToken.clientId, row.clientId),
        eq(oauthAccessToken.userId, row.userId),
        inArray(oauthAccessToken.referenceId, refs),
      ),
    )
  await tx
    .update(oauthRefreshToken)
    .set({
      revoked: now,
      rotatedAt: null,
      rotationReplayExpiresAt: null,
      rotationReplayResponse: null,
    })
    .where(
      and(
        eq(oauthRefreshToken.clientId, row.clientId),
        eq(oauthRefreshToken.userId, row.userId),
        inArray(oauthRefreshToken.referenceId, refs),
      ),
    )
}

/** Replay invalidates this connection generation, leaving other sites intact. */
export async function revokeReplayedGrant(row: McpConnectionRow) {
  await withConnectionLock(row, async () => {
    await db.transaction(async (tx) => {
      const now = new Date()
      const [revoked] = await tx
        .update(mcpConnection)
        .set({ revokedAt: now })
        .where(
          and(eq(mcpConnection.id, row.id), isNull(mcpConnection.revokedAt)),
        )
        .returning()
      await revokeGenerationTokens(tx, row, [row.id], now)
      await tx.delete(oauthConsent).where(eq(oauthConsent.referenceId, row.id))
      // An agency connection has no site to audit against.
      const [target] = row.siteId
        ? await tx
            .select({ organizationId: site.organizationId })
            .from(site)
            .where(eq(site.id, row.siteId))
        : []
      if (revoked && target)
        await audit(
          {
            organizationId: target.organizationId,
            siteId: row.siteId,
            actorId: row.userId,
            action: 'mcp_connection.revoke',
            targetType: 'mcp_connection',
            targetId: row.id,
            meta: {
              clientName: row.clientName,
              allowGoLive: row.allowGoLive,
              reason: 'refresh_token_replay',
            },
          },
          tx,
        )
    })
  })
}

/**
 * The usable connection for a verified token's (user, app, site), or null.
 * Called on every MCP request, after the token itself was verified.
 */
export async function findUsableConnection(input: {
  userId: string
  siteId: string
  clientId: string
  now?: Date
}): Promise<McpConnectionRow | null> {
  const now = input.now ?? new Date()
  const [row] = await db
    .select()
    .from(mcpConnection)
    .where(
      and(
        eq(mcpConnection.userId, input.userId),
        eq(mcpConnection.siteId, input.siteId),
        eq(mcpConnection.clientId, input.clientId),
        isNull(mcpConnection.revokedAt),
      ),
    )
    .limit(1)
  if (!row || !isConnectionUsable(row, now)) return null
  return row
}

/**
 * The usable agency connection for a verified token's (user, app), or null.
 * Agency connections have no site, so they are found by scope instead.
 */
export async function findUsableAgencyConnection(input: {
  userId: string
  clientId: string
  now?: Date
}): Promise<McpConnectionRow | null> {
  const now = input.now ?? new Date()
  const [row] = await db
    .select()
    .from(mcpConnection)
    .where(
      and(
        eq(mcpConnection.userId, input.userId),
        eq(mcpConnection.scope, 'agency'),
        eq(mcpConnection.clientId, input.clientId),
        isNull(mcpConnection.revokedAt),
      ),
    )
    .limit(1)
  if (!row || !isConnectionUsable(row, now)) return null
  return row
}

/** The caller's usable agency connections, newest first. */
export async function listAgencyConnections(input: {
  userId: string
  now?: Date
}): Promise<McpConnectionSummary[]> {
  const now = input.now ?? new Date()
  const rows = await db
    .select({ connection: mcpConnection, userName: user.name })
    .from(mcpConnection)
    .leftJoin(user, eq(user.id, mcpConnection.userId))
    .where(
      and(
        eq(mcpConnection.userId, input.userId),
        eq(mcpConnection.scope, 'agency'),
        isNull(mcpConnection.revokedAt),
      ),
    )
    .orderBy(desc(mcpConnection.createdAt))
  return rows
    .filter((row) => isConnectionUsable(row.connection, now))
    .map((row) => ({
      id: row.connection.id,
      clientId: row.connection.clientId,
      clientName: row.connection.clientName,
      userId: row.connection.userId,
      userName: row.userName ?? null,
      allowGoLive: row.connection.allowGoLive,
      createdAt: row.connection.createdAt,
      lastUsedAt: row.connection.lastUsedAt,
    }))
}

/** Records use, at most once a minute per connection. */
export async function touchConnection(
  row: Pick<McpConnectionRow, 'id' | 'lastUsedAt'>,
  now: Date = new Date(),
): Promise<void> {
  if (
    row.lastUsedAt &&
    now.getTime() - row.lastUsedAt.getTime() <= LAST_USED_WRITE_INTERVAL_MS
  ) {
    return
  }
  await db
    .update(mcpConnection)
    .set({ lastUsedAt: now })
    .where(
      and(
        eq(mcpConnection.id, row.id),
        isNull(mcpConnection.revokedAt),
        sql`(${mcpConnection.lastUsedAt} is null or ${mcpConnection.lastUsedAt} < ${now})`,
      ),
    )
}
