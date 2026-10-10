/* eslint-disable @typescript-eslint/no-unnecessary-condition -- row lookups after .returning()/.select() are checked defensively */
import { and, desc, eq, isNull } from 'drizzle-orm'

import { db } from '#/db'
import {
  mcpConnection,
  oauthAccessToken,
  oauthConsent,
  oauthRefreshToken,
  user,
} from '#/db/schema'
import { m } from '#/paraglide/messages'
import { audit } from '#/server/audit'
import { NotFoundError } from '#/server/content/errors'

import { MCP_CONNECTION_IDLE_MS } from './oauth-resource'

const LAST_USED_WRITE_INTERVAL_MS = 60_000

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
  const now = input.now ?? new Date()
  const clientName = input.clientName.trim() || 'AI app'

  const [existing] = await db
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

  let row: McpConnectionRow | undefined
  if (existing) {
    ;[row] = await db
      .update(mcpConnection)
      .set({ clientName, allowGoLive: input.allowGoLive })
      .where(eq(mcpConnection.id, existing.id))
      .returning()
  } else {
    ;[row] = await db
      .insert(mcpConnection)
      .values({
        userId: input.userId,
        siteId: input.siteId,
        clientId: input.clientId,
        clientName,
        allowGoLive: input.allowGoLive,
        createdAt: now,
      })
      .returning()
  }
  if (!row) throw new Error('Failed to record MCP connection')

  await audit({
    organizationId: input.organizationId,
    siteId: input.siteId,
    actorId: input.userId,
    action: 'mcp_connection.create',
    targetType: 'mcp_connection',
    targetId: row.id,
    meta: { clientName, allowGoLive: row.allowGoLive },
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
  const now = input.now ?? new Date()
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
  if (!row) throw new NotFoundError(m.server_mcp_connection_not_found())
  if (row.userId !== input.actorId && !input.canRevokeOthers) {
    throw new NotFoundError(m.server_mcp_connection_not_found())
  }
  if (row.revokedAt) return

  await db.transaction(async (tx) => {
    await tx
      .update(mcpConnection)
      .set({ revokedAt: now })
      .where(eq(mcpConnection.id, row.id))
    // Consent, access and refresh tokens are keyed by the site id that the
    // authorization was bound to (see siteIdForAuthorizationQuery).
    const scope = and(
      eq(oauthConsent.clientId, row.clientId),
      eq(oauthConsent.userId, row.userId),
      eq(oauthConsent.referenceId, row.siteId),
    )
    await tx.delete(oauthConsent).where(scope)
    await tx
      .update(oauthAccessToken)
      .set({ revoked: now })
      .where(
        and(
          eq(oauthAccessToken.clientId, row.clientId),
          eq(oauthAccessToken.userId, row.userId),
          eq(oauthAccessToken.referenceId, row.siteId),
          isNull(oauthAccessToken.revoked),
        ),
      )
    await tx
      .update(oauthRefreshToken)
      .set({ revoked: now })
      .where(
        and(
          eq(oauthRefreshToken.clientId, row.clientId),
          eq(oauthRefreshToken.userId, row.userId),
          eq(oauthRefreshToken.referenceId, row.siteId),
          isNull(oauthRefreshToken.revoked),
        ),
      )
  })

  await audit({
    organizationId: input.organizationId,
    siteId: input.siteId,
    actorId: input.actorId,
    action: 'mcp_connection.revoke',
    targetType: 'mcp_connection',
    targetId: row.id,
    meta: { clientName: row.clientName, allowGoLive: row.allowGoLive },
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
    .where(eq(mcpConnection.id, row.id))
}
