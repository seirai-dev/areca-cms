/* eslint-disable @typescript-eslint/no-unnecessary-condition -- row lookups after .returning()/.select() are checked defensively */
import { randomBytes } from 'node:crypto'
import { and, count, desc, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm'

import { db } from '#/db'
import type { McpScope } from '#/db/schema'
import { mcpKey, site, user } from '#/db/schema'
import { env } from '#/env'
import { m } from '#/paraglide/messages'
import { audit } from '#/server/audit'
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '#/server/content/errors'
import { orgRoleOf } from '#/server/security/org-role'
import { hashToken } from '#/server/security/token-hash'
import { revokeAgencyMcpConnections } from './connections'

export type McpRole = 'editor' | 'owner' | 'agency'

/** How the caller connected: a personal key, or an app signed in with OAuth. */
export type McpCredential = 'key' | 'oauth'

export type McpActor = {
  /** The key id, or the mcp_connection id for OAuth. */
  keyId: string
  keyName: string
  credential: McpCredential
  /** 'site' for a per-site credential; 'agency' for a call through the agency connector (agency-call.ts). */
  scope: McpScope
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
  return hashToken(token)
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

async function userNameOf(
  userId: string,
  connection: Pick<typeof db, 'select'> = db,
) {
  const [found] = await connection
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

  return db.transaction(async (tx) => {
    // Serialize the count/insert pair across processes for this user and site.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${JSON.stringify(['mcp-key', input.userId, input.siteId])}, 0))`,
    )
    const [active] = await tx
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
    const [row] = await tx
      .insert(mcpKey)
      .values({
        userId: input.userId,
        scope: 'site',
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

    await audit(
      {
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
      },
      tx,
    )

    return {
      key: toSummary(row, await userNameOf(input.userId, tx)),
      token: generated.token,
    }
  })
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

/**
 * Revokes every active key a user holds on the given sites. Used when they leave
 * the organization: the keys stay revoked, so rejoining needs new ones.
 * Returns the number of keys revoked.
 */
export async function revokeMemberMcpKeys(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  input: { userId: string; siteIds: string[]; now?: Date },
): Promise<number> {
  if (input.siteIds.length === 0) return 0
  const revoked = await tx
    .update(mcpKey)
    .set({ revokedAt: input.now ?? new Date() })
    .where(
      and(
        eq(mcpKey.userId, input.userId),
        inArray(mcpKey.siteId, input.siteIds),
        isNull(mcpKey.revokedAt),
      ),
    )
    .returning({ id: mcpKey.id })
  return revoked.length
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
  owner: {
    id: string
    isAgencyAdmin: boolean
    twoFactorEnabled: boolean
    blockedAt?: Date | null
  },
  organizationId: string,
): Promise<LiveRoleResult> {
  // Suspended, not revoked: keys and connections work again once unblocked.
  if (owner.blockedAt) return { ok: false, reason: 'invalid' }
  const role = await orgRoleOf(owner, organizationId)
  if (!role) return { ok: false, reason: 'invalid' }
  // Mirrors assertAdminMfa in lib/session.server.ts. Not imported, because
  // that module pulls in request-only APIs.
  if (role === 'agency' && env.ADMIN_MFA_REQUIRED && !owner.twoFactorEnabled) {
    return { ok: false, reason: 'mfa_required' }
  }
  return { ok: true, role }
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
  // Agency keys have no site; they never work on a site address.
  if (key.scope !== 'site') return invalid

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
      scope: 'site',
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

// ---------------------------------------------------------------------------
// Agency keys: one key that reaches every site (docs/design/agency-mcp.md).
// They live in mcp_key with scope 'agency' and no site.

/** The user an agency credential acts as, read live on every request. */
export type AgencyAccessUser = {
  id: string
  isAgencyAdmin: boolean
  blockedAt?: Date | null
}

/**
 * The caller of the agency connector. It has no site: each tool call names
 * one (agency-call.ts). An OAuth connection produces the same shape with
 * `credential: 'oauth'`, so the connector does not change when OAuth lands.
 */
export type AgencyPrincipal = {
  scope: 'agency'
  role: 'agency'
  keyId: string
  keyName: string
  credential: McpCredential
  userId: string
  userName: string
  user: AgencyAccessUser
}

export type AgencyAdminStatus =
  'active' | 'blocked' | 'mfa_required' | 'not_admin'

/**
 * Whether a user may use agency credentials right now. Checked on every
 * request, so a demotion, a block or a lost second factor takes effect at once.
 */
export function agencyAdminStatus(owner: {
  isAgencyAdmin: boolean
  twoFactorEnabled: boolean
  blockedAt?: Date | null
}): AgencyAdminStatus {
  if (!owner.isAgencyAdmin) return 'not_admin'
  if (owner.blockedAt) return 'blocked'
  // Mirrors assertAdminMfa in lib/session.server.ts (see liveRoleFor).
  if (env.ADMIN_MFA_REQUIRED && !owner.twoFactorEnabled) return 'mfa_required'
  return 'active'
}

const AGENCY_KEY_REFUSAL: Record<
  Exclude<AgencyAdminStatus, 'active'>,
  string
> = {
  not_admin: 'Only agency admins can create agency AI keys.',
  blocked: 'This account is blocked, so it cannot create agency AI keys.',
  mfa_required:
    'Turn on two-factor authentication before creating an agency AI key.',
}

/**
 * Creates a personal agency key. The server function checks the fresh second
 * factor; this re-reads the user, so a user who has stopped being an agency
 * admin cannot create one. Agency keys never allow going live: the agency
 * connector does not need the flag (docs/design/agency-mcp.md, Decision 10).
 */
export async function createAgencyMcpKey(input: {
  userId: string
  name: string
  expiresInDays: 30 | 90 | 365 | null
  now?: Date
}): Promise<{ key: McpKeySummary; token: string }> {
  const now = input.now ?? new Date()
  const name = input.name.trim()
  if (name.length < 1 || name.length > NAME_MAX_LENGTH) {
    throw new ValidationError([
      { path: '', message: m.server_mcp_key_name_invalid() },
    ])
  }

  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${JSON.stringify(['mcp-key', input.userId, 'agency'])}, 0))`,
    )
    const [owner] = await tx
      .select({
        id: user.id,
        name: user.name,
        isAgencyAdmin: user.isAgencyAdmin,
        twoFactorEnabled: user.twoFactorEnabled,
        blockedAt: user.blockedAt,
      })
      .from(user)
      .where(eq(user.id, input.userId))
      .limit(1)
    if (!owner) throw new NotFoundError(m.server_user_not_found())
    const status = agencyAdminStatus(owner)
    if (status !== 'active') {
      throw new ForbiddenError(AGENCY_KEY_REFUSAL[status])
    }

    const [active] = await tx
      .select({ value: count() })
      .from(mcpKey)
      .where(
        and(
          eq(mcpKey.userId, input.userId),
          eq(mcpKey.scope, 'agency'),
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
    const [row] = await tx
      .insert(mcpKey)
      .values({
        userId: input.userId,
        scope: 'agency',
        siteId: null,
        name,
        tokenPrefix: generated.tokenPrefix,
        tokenHash: generated.tokenHash,
        allowGoLive: false,
        expiresAt,
        createdAt: now,
      })
      .returning()
    if (!row) throw new Error('Failed to create agency MCP key')

    await audit(
      {
        organizationId: null,
        actorId: input.userId,
        action: 'mcp_key.create',
        targetType: 'mcp_key',
        targetId: row.id,
        meta: {
          name,
          scope: 'agency',
          allowGoLive: false,
          expiresAt: expiresAt?.toISOString() ?? null,
        },
      },
      tx,
    )

    return { key: toSummary(row, owner.name), token: generated.token }
  })
}

/** The user's own non-revoked agency keys, newest first. */
export async function listAgencyMcpKeys(input: {
  userId: string
}): Promise<McpKeySummary[]> {
  const rows = await db
    .select({ key: mcpKey, userName: user.name })
    .from(mcpKey)
    .leftJoin(user, eq(user.id, mcpKey.userId))
    .where(
      and(
        eq(mcpKey.scope, 'agency'),
        eq(mcpKey.userId, input.userId),
        isNull(mcpKey.revokedAt),
      ),
    )
    .orderBy(desc(mcpKey.createdAt))
  return rows.map((row) => toSummary(row.key, row.userName ?? null))
}

/** Revokes one of the caller's agency keys. Other people's keys are not visible here. */
export async function revokeAgencyMcpKey(input: {
  id: string
  userId: string
  now?: Date
}): Promise<void> {
  const [row] = await db
    .select()
    .from(mcpKey)
    .where(
      and(
        eq(mcpKey.id, input.id),
        eq(mcpKey.scope, 'agency'),
        eq(mcpKey.userId, input.userId),
      ),
    )
    .limit(1)
  if (!row) throw new NotFoundError(m.server_mcp_key_not_found())
  if (row.revokedAt) return

  await db
    .update(mcpKey)
    .set({ revokedAt: input.now ?? new Date() })
    .where(eq(mcpKey.id, row.id))

  await audit({
    organizationId: null,
    actorId: input.userId,
    action: 'mcp_key.revoke',
    targetType: 'mcp_key',
    targetId: row.id,
    meta: { name: row.name, scope: 'agency' },
  })
}

/**
 * Revokes every agency key a user holds, and their agency app connections.
 * Runs in the caller's transaction when an agency admin loses the role
 * (docs/design/agency-mcp.md, Decision 12). Returns the number of keys revoked.
 */
export async function revokeAgencyMcpCredentials(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  input: { userId: string; now?: Date },
): Promise<number> {
  const now = input.now ?? new Date()
  const revoked = await tx
    .update(mcpKey)
    .set({ revokedAt: now })
    .where(
      and(
        eq(mcpKey.userId, input.userId),
        eq(mcpKey.scope, 'agency'),
        isNull(mcpKey.revokedAt),
      ),
    )
    .returning({ id: mcpKey.id })
  await revokeAgencyMcpConnections(tx, { userId: input.userId, now })
  return revoked.length
}

export type AgencyResolution =
  | { ok: true; principal: AgencyPrincipal }
  | {
      ok: false
      /**
       * invalid: unknown, revoked, expired or blocked. not_agency: the key is
       * valid but its owner is not an agency admin (the caller gets the same
       * 404 as an unknown address). wrong_scope: a site key on the agency
       * address. mfa_required: the agency admin must turn on two-factor auth.
       */
      reason: 'invalid' | 'not_agency' | 'wrong_scope' | 'mfa_required'
    }

/**
 * Resolves a bearer token for the agency connector. Never throws. The owner
 * must be an agency admin with MFA, read live on every request.
 */
export async function resolveAgencyPrincipal(
  token: string,
  now: Date = new Date(),
): Promise<AgencyResolution> {
  const invalid = { ok: false as const, reason: 'invalid' as const }
  if (!token.startsWith(MCP_KEY_PREFIX)) return invalid

  const [found] = await db
    .select({ key: mcpKey, owner: user })
    .from(mcpKey)
    .innerJoin(user, eq(user.id, mcpKey.userId))
    .where(eq(mcpKey.tokenHash, hashMcpKey(token)))
    .limit(1)
  if (!found) return invalid

  const { key, owner } = found
  if (key.revokedAt) return invalid
  if (key.expiresAt && key.expiresAt.getTime() <= now.getTime()) return invalid

  const status = agencyAdminStatus(owner)
  if (status === 'not_admin') return { ok: false, reason: 'not_agency' }
  if (key.scope !== 'agency') return { ok: false, reason: 'wrong_scope' }
  if (status === 'mfa_required') return { ok: false, reason: 'mfa_required' }
  if (status === 'blocked') return invalid

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
    principal: {
      scope: 'agency',
      role: 'agency',
      keyId: key.id,
      keyName: key.name,
      credential: 'key',
      userId: owner.id,
      userName: owner.name,
      user: { id: owner.id, isAgencyAdmin: true, blockedAt: owner.blockedAt },
    },
  }
}
