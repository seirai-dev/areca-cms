/* eslint-disable @typescript-eslint/no-unnecessary-condition -- row lookups after .returning()/.select() are checked defensively */
import { createHash, randomBytes } from 'node:crypto'
import { and, count, desc, eq, gt, isNull, or } from 'drizzle-orm'

import { db } from '#/db'
import { membership, mcpKey, site, user } from '#/db/schema'
import { env } from '#/env'
import { m } from '#/paraglide/messages'
import { audit } from '#/server/audit'
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '#/server/content/errors'

export type McpRole = 'editor' | 'owner' | 'agency'

/** How the caller connected: a personal key, or an app signed in with OAuth. */
export type McpCredential = 'key' | 'oauth'

export type McpActor = {
  /** The key id, or the mcp_connection id for OAuth. */
  keyId: string
  keyName: string
  credential: McpCredential
  userId: string
  userName: string
  siteId: string
  siteSlug: string
  siteName: string
  organizationId: string
  role: McpRole
  /** Effective: key flag && role !== 'editor'. */
  allowGoLive: boolean
}

export const MCP_KEY_PREFIX = 'areca_mcp_'
/** Days until expiry; null means the key never expires. */
export const MCP_KEY_EXPIRY_OPTIONS = [30, 90, 365, null] as const

const TOKEN_BYTES = 32
const TOKEN_DISPLAY_PREFIX_LENGTH = 14
const NAME_MAX_LENGTH = 80
const MAX_ACTIVE_KEYS_PER_USER_PER_SITE = 20
const LAST_USED_WRITE_INTERVAL_MS = 60_000
const DAY_MS = 24 * 60 * 60 * 1000

export type McpKeySummary = {
  id: string
  name: string
  tokenPrefix: string
  allowGoLive: boolean
  expiresAt: Date | null
  lastUsedAt: Date | null
  revokedAt: Date | null
  createdAt: Date
  userId: string
  userName: string | null
}

export function hashMcpKey(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function generateMcpKey(): {
  token: string
  tokenHash: string
  tokenPrefix: string
} {
  const token = MCP_KEY_PREFIX + randomBytes(TOKEN_BYTES).toString('base64url')
  return {
    token,
    tokenHash: hashMcpKey(token),
    tokenPrefix: token.slice(0, TOKEN_DISPLAY_PREFIX_LENGTH),
  }
}

type KeyRow = typeof mcpKey.$inferSelect

function toSummary(row: KeyRow, userName: string | null): McpKeySummary {
  return {
    id: row.id,
    name: row.name,
    tokenPrefix: row.tokenPrefix,
    allowGoLive: row.allowGoLive,
    expiresAt: row.expiresAt,
    lastUsedAt: row.lastUsedAt,
    revokedAt: row.revokedAt,
    createdAt: row.createdAt,
    userId: row.userId,
    userName,
  }
}

async function userNameOf(userId: string) {
  const [found] = await db
    .select({ name: user.name })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1)
  return found?.name ?? null
}

export async function createMcpKey(input: {
  userId: string
  siteId: string
  organizationId: string
  name: string
  expiresInDays: 30 | 90 | 365 | null
  allowGoLive: boolean
  role: McpRole
  now?: Date
}): Promise<{ key: McpKeySummary; token: string }> {
  const now = input.now ?? new Date()
  const name = input.name.trim()
  if (name.length < 1 || name.length > NAME_MAX_LENGTH) {
    throw new ValidationError([
      { path: '', message: m.server_mcp_key_name_invalid() },
    ])
  }
  if (input.allowGoLive && input.role === 'editor') {
    throw new ForbiddenError(m.server_mcp_key_go_live_owners_only())
  }

  const [active] = await db
    .select({ value: count() })
    .from(mcpKey)
    .where(
      and(
        eq(mcpKey.userId, input.userId),
        eq(mcpKey.siteId, input.siteId),
        isNull(mcpKey.revokedAt),
        or(isNull(mcpKey.expiresAt), gt(mcpKey.expiresAt, now)),
      ),
    )
  if (Number(active?.value ?? 0) >= MAX_ACTIVE_KEYS_PER_USER_PER_SITE) {
    throw new ConflictError(m.server_mcp_key_limit_reached())
  }

  const expiresAt =
    input.expiresInDays === null
      ? null
      : new Date(now.getTime() + input.expiresInDays * DAY_MS)
  const generated = generateMcpKey()
  const [row] = await db
    .insert(mcpKey)
    .values({
      userId: input.userId,
      siteId: input.siteId,
      name,
      tokenPrefix: generated.tokenPrefix,
      tokenHash: generated.tokenHash,
      allowGoLive: input.allowGoLive,
      expiresAt,
      createdAt: now,
    })
    .returning()
  if (!row) throw new Error('Failed to create MCP key')

  await audit({
    organizationId: input.organizationId,
    siteId: input.siteId,
    actorId: input.userId,
    action: 'mcp_key.create',
    targetType: 'mcp_key',
    targetId: row.id,
    meta: {
      name,
      allowGoLive: input.allowGoLive,
      expiresAt: expiresAt?.toISOString() ?? null,
    },
  })

  return {
    key: toSummary(row, await userNameOf(input.userId)),
    token: generated.token,
  }
}

/**
 * Non-revoked keys for a site, newest first. Expired keys are included so the
 * UI can show them as expired. Without `includeAllUsers` only the caller's
 * own keys are returned.
 */
export async function listMcpKeys(input: {
  siteId: string
  userId: string
  includeAllUsers: boolean
}): Promise<McpKeySummary[]> {
  const rows = await db
    .select({ key: mcpKey, userName: user.name })
    .from(mcpKey)
    .leftJoin(user, eq(user.id, mcpKey.userId))
    .where(
      and(
        eq(mcpKey.siteId, input.siteId),
        isNull(mcpKey.revokedAt),
        input.includeAllUsers ? undefined : eq(mcpKey.userId, input.userId),
      ),
    )
    .orderBy(desc(mcpKey.createdAt))
  return rows.map((row) => toSummary(row.key, row.userName ?? null))
}

export async function revokeMcpKey(input: {
  id: string
  siteId: string
  actorId: string
  organizationId: string
  canRevokeOthers: boolean
}): Promise<void> {
  const [row] = await db
    .select()
    .from(mcpKey)
    .where(and(eq(mcpKey.id, input.id), eq(mcpKey.siteId, input.siteId)))
    .limit(1)
  if (!row) throw new NotFoundError(m.server_mcp_key_not_found())
  if (row.userId !== input.actorId && !input.canRevokeOthers) {
    throw new NotFoundError(m.server_mcp_key_not_found())
  }
  if (row.revokedAt) return

  await db
    .update(mcpKey)
    .set({ revokedAt: new Date() })
    .where(eq(mcpKey.id, row.id))

  await audit({
    organizationId: input.organizationId,
    siteId: input.siteId,
    actorId: input.actorId,
    action: 'mcp_key.revoke',
    targetType: 'mcp_key',
    targetId: row.id,
    meta: { name: row.name },
  })
}

export type McpResolution =
  | { ok: true; actor: McpActor }
  | { ok: false; reason: 'invalid' | 'mfa_required' }

export type LiveRoleResult =
  | { ok: true; role: McpRole }
  | { ok: false; reason: 'invalid' | 'mfa_required' }

/**
 * The user's live role on a site's organization, read on every request so a
 * demotion or removed membership takes effect at once. Shared by personal keys
 * and OAuth connections so both obey the same rules.
 */
export async function liveRoleFor(
  owner: { id: string; isAgencyAdmin: boolean; twoFactorEnabled: boolean },
  organizationId: string,
): Promise<LiveRoleResult> {
  if (owner.isAgencyAdmin) {
    // Mirrors assertAdminMfa in lib/session.server.ts. Not imported, because
    // that module pulls in request-only APIs.
    if (env.ADMIN_MFA_REQUIRED && !owner.twoFactorEnabled) {
      return { ok: false, reason: 'mfa_required' }
    }
    return { ok: true, role: 'agency' }
  }
  const [member] = await db
    .select({ role: membership.role })
    .from(membership)
    .where(
      and(
        eq(membership.userId, owner.id),
        eq(membership.organizationId, organizationId),
      ),
    )
    .limit(1)
  if (!member) return { ok: false, reason: 'invalid' }
  return { ok: true, role: member.role }
}

/**
 * Resolve a bearer token to the acting user and their live role on the key's
 * site. Never throws. `reason` says why a key was refused: `mfa_required` means
 * the key is valid but its agency admin must turn on two-factor auth first.
 */
export async function resolveMcpActorResult(
  token: string,
  now: Date = new Date(),
): Promise<McpResolution> {
  const invalid = { ok: false as const, reason: 'invalid' as const }
  if (!token.startsWith(MCP_KEY_PREFIX)) return invalid

  const [found] = await db
    .select({ key: mcpKey, owner: user, target: site })
    .from(mcpKey)
    .innerJoin(user, eq(user.id, mcpKey.userId))
    .innerJoin(site, eq(site.id, mcpKey.siteId))
    .where(eq(mcpKey.tokenHash, hashMcpKey(token)))
    .limit(1)
  if (!found) return invalid

  const { key, owner, target } = found
  if (key.revokedAt) return invalid
  if (key.expiresAt && key.expiresAt.getTime() <= now.getTime()) return invalid

  const live = await liveRoleFor(owner, target.organizationId)
  if (!live.ok) return live

  if (
    !key.lastUsedAt ||
    now.getTime() - key.lastUsedAt.getTime() > LAST_USED_WRITE_INTERVAL_MS
  ) {
    await db
      .update(mcpKey)
      .set({ lastUsedAt: now })
      .where(eq(mcpKey.id, key.id))
  }

  return {
    ok: true,
    actor: {
      keyId: key.id,
      keyName: key.name,
      credential: 'key',
      userId: owner.id,
      userName: owner.name,
      siteId: target.id,
      siteSlug: target.slug,
      siteName: target.name,
      organizationId: target.organizationId,
      role: live.role,
      allowGoLive: key.allowGoLive && live.role !== 'editor',
    },
  }
}

/** Actor-or-null form of `resolveMcpActorResult`, for callers that do not need the reason. */
export async function resolveMcpActor(
  token: string,
  now: Date = new Date(),
): Promise<McpActor | null> {
  const result = await resolveMcpActorResult(token, now)
  return result.ok ? result.actor : null
}
