/* eslint-disable @typescript-eslint/no-unnecessary-condition -- row lookups after .returning()/.select() are checked defensively */
import { eq, inArray } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'

import { db } from '#/db'
import { auditLog, membership, mcpKey, user } from '#/db/schema'
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '#/server/content/errors'
import { withTestSite } from '#/server/content/test-utils'

import {
  createMcpKey,
  listMcpKeys,
  MCP_KEY_PREFIX,
  resolveMcpActor,
  resolveMcpActorResult,
  revokeMcpKey,
} from './keys'

// Must run before `#/env` is first imported: resolution reads ADMIN_MFA_REQUIRED.
vi.hoisted(() => {
  process.env.ADMIN_MFA_REQUIRED = 'true'
})

const hasDb = Boolean(process.env.DATABASE_URL)
const DAY = 24 * 60 * 60 * 1000

describe.skipIf(!hasDb)('MCP keys', () => {
  async function withKeyWorld(
    run: (world: Awaited<ReturnType<typeof buildWorld>>) => Promise<void>,
  ) {
    await withTestSite(async (ctx) => {
      const world = await buildWorld(ctx)
      try {
        await run(world)
      } finally {
        await db.delete(user).where(inArray(user.id, world.userIds))
      }
    })
  }

  async function buildWorld(ctx: {
    org: { id: string }
    site: { id: string; slug: string }
    actor: { id: string }
  }) {
    const userIds: string[] = []
    const addUser = async (
      label: string,
      flags: { role?: 'owner' | 'editor'; agency?: boolean; twoFactor?: boolean } = {},
    ) => {
      const id = crypto.randomUUID()
      userIds.push(id)
      await db.insert(user).values({
        id,
        name: label,
        email: `${label}-${id}@test.local`,
        emailVerified: true,
        isAgencyAdmin: Boolean(flags.agency),
        twoFactorEnabled: Boolean(flags.twoFactor),
      })
      if (flags.role) {
        await db.insert(membership).values({
          userId: id,
          organizationId: ctx.org.id,
          role: flags.role,
        })
      }
      return id
    }

    const owner = ctx.actor.id
    await db.insert(membership).values({
      userId: owner,
      organizationId: ctx.org.id,
      role: 'owner',
    })
    userIds.push(owner)
    const editor = await addUser('editor', { role: 'editor' })
    const agency = await addUser('agency', { agency: true, twoFactor: true })
    const agencyNoMfa = await addUser('agency-nomfa', { agency: true })

    return {
      userIds,
      org: ctx.org,
      site: ctx.site,
      owner,
      editor,
      agency,
      agencyNoMfa,
      addUser,
      create: (
        userId: string,
        role: 'owner' | 'editor' | 'agency',
        overrides: Partial<Parameters<typeof createMcpKey>[0]> = {},
      ) =>
        createMcpKey({
          userId,
          siteId: ctx.site.id,
          organizationId: ctx.org.id,
          name: 'Laptop',
          expiresInDays: 90,
          allowGoLive: false,
          role,
          ...overrides,
        }),
    }
  }

  it('creates a key whose summary never includes the hash, and audits it', async () => {
    await withKeyWorld(async (w) => {
      const { key, token } = await w.create(w.owner, 'owner', {
        name: '  Claude desktop  ',
        allowGoLive: true,
      })
      expect(token.startsWith(MCP_KEY_PREFIX)).toBe(true)
      expect(key.tokenPrefix).toBe(token.slice(0, 14))
      expect(key.name).toBe('Claude desktop')
      expect(key.allowGoLive).toBe(true)
      expect(key.userName).toBe('Test Actor')
      expect(key).not.toHaveProperty('tokenHash')
      expect(JSON.stringify(key)).not.toContain(token.slice(14))

      const [row] = await db.select().from(mcpKey).where(eq(mcpKey.id, key.id))
      expect(row?.tokenHash).toMatch(/^[0-9a-f]{64}$/)
      expect(row?.tokenHash).not.toBe(token)

      const [entry] = await db
        .select()
        .from(auditLog)
        .where(eq(auditLog.targetId, key.id))
      expect(entry?.action).toBe('mcp_key.create')
      expect(entry?.targetType).toBe('mcp_key')
      expect(entry?.meta).toMatchObject({ name: 'Claude desktop', allowGoLive: true })
    })
  })

  it('resolves an owner key with the owner role and go-live allowed', async () => {
    await withKeyWorld(async (w) => {
      const { token, key } = await w.create(w.owner, 'owner', { allowGoLive: true })
      const actor = await resolveMcpActor(token)
      expect(actor).toMatchObject({
        keyId: key.id,
        keyName: 'Laptop',
        userId: w.owner,
        siteId: w.site.id,
        siteSlug: w.site.slug,
        organizationId: w.org.id,
        role: 'owner',
        allowGoLive: true,
      })
    })
  })

  it('resolves an editor key with the editor role and no go-live', async () => {
    await withKeyWorld(async (w) => {
      const { token } = await w.create(w.editor, 'editor')
      const actor = await resolveMcpActor(token)
      expect(actor?.role).toBe('editor')
      expect(actor?.allowGoLive).toBe(false)
    })
  })

  it('refuses allowGoLive for editors and an empty or too long name', async () => {
    await withKeyWorld(async (w) => {
      await expect(
        w.create(w.editor, 'editor', { allowGoLive: true }),
      ).rejects.toBeInstanceOf(ForbiddenError)
      await expect(w.create(w.owner, 'owner', { name: '   ' })).rejects.toBeInstanceOf(
        ValidationError,
      )
      await expect(
        w.create(w.owner, 'owner', { name: 'x'.repeat(81) }),
      ).rejects.toBeInstanceOf(ValidationError)
    })
  })

  it('resolves agency admins with 2FA as agency and blocks them without 2FA', async () => {
    await withKeyWorld(async (w) => {
      const { token } = await w.create(w.agency, 'agency', { allowGoLive: true })
      const actor = await resolveMcpActor(token)
      expect(actor?.role).toBe('agency')
      expect(actor?.allowGoLive).toBe(true)

      const noMfa = await createMcpKey({
        userId: w.agencyNoMfa,
        siteId: w.site.id,
        organizationId: w.org.id,
        name: 'Admin without 2FA',
        expiresInDays: null,
        allowGoLive: false,
        role: 'agency',
      })
      await expect(resolveMcpActor(noMfa.token)).resolves.toBeNull()
    })
  })

  it('says why an agency key is refused: missing 2FA is not the same as a bad key', async () => {
    await withKeyWorld(async (w) => {
      const noMfa = await createMcpKey({
        userId: w.agencyNoMfa,
        siteId: w.site.id,
        organizationId: w.org.id,
        name: 'Admin without 2FA',
        expiresInDays: null,
        allowGoLive: false,
        role: 'agency',
      })
      await expect(resolveMcpActorResult(noMfa.token)).resolves.toEqual({
        ok: false,
        reason: 'mfa_required',
      })
      await expect(resolveMcpActorResult('areca_mcp_no-such-key')).resolves.toEqual({
        ok: false,
        reason: 'invalid',
      })
      const { token } = await w.create(w.agency, 'agency', { allowGoLive: false })
      const result = await resolveMcpActorResult(token)
      expect(result.ok).toBe(true)
    })
  })

  it('returns null for unknown, foreign-prefix, expired and revoked tokens', async () => {
    await withKeyWorld(async (w) => {
      const now = new Date()
      const { token, key } = await w.create(w.owner, 'owner', {
        expiresInDays: 30,
        now,
      })
      expect(await resolveMcpActor('sk_not_ours')).toBeNull()
      expect(await resolveMcpActor(`${MCP_KEY_PREFIX}unknown-token`)).toBeNull()
      expect(await resolveMcpActor(token, new Date(now.getTime() + 31 * DAY))).toBeNull()

      const other = await w.create(w.owner, 'owner')
      await revokeMcpKey({
        id: other.key.id,
        siteId: w.site.id,
        actorId: w.owner,
        organizationId: w.org.id,
        canRevokeOthers: true,
      })
      expect(await resolveMcpActor(other.token)).toBeNull()

      expect(await resolveMcpActor(token, now)).not.toBeNull()
      expect(key.revokedAt).toBeNull()
    })
  })

  it('returns null once the membership is removed', async () => {
    await withKeyWorld(async (w) => {
      const { token } = await w.create(w.editor, 'editor')
      expect(await resolveMcpActor(token)).not.toBeNull()
      await db
        .delete(membership)
        .where(eq(membership.userId, w.editor))
      expect(await resolveMcpActor(token)).toBeNull()
    })
  })

  it('updates lastUsedAt at most once a minute', async () => {
    await withKeyWorld(async (w) => {
      const { token, key } = await w.create(w.owner, 'owner')
      expect(key.lastUsedAt).toBeNull()

      const t0 = new Date(Date.now() + 1000)
      await resolveMcpActor(token, t0)
      const [first] = await listMcpKeys({
        siteId: w.site.id,
        userId: w.owner,
        includeAllUsers: true,
      })
      expect(first?.lastUsedAt?.getTime()).toBe(t0.getTime())

      await resolveMcpActor(token, new Date(t0.getTime() + 10_000))
      const [second] = await listMcpKeys({
        siteId: w.site.id,
        userId: w.owner,
        includeAllUsers: true,
      })
      expect(second?.lastUsedAt?.getTime()).toBe(t0.getTime())

      const t1 = new Date(t0.getTime() + 61_000)
      await resolveMcpActor(token, t1)
      const [third] = await listMcpKeys({
        siteId: w.site.id,
        userId: w.owner,
        includeAllUsers: true,
      })
      expect(third?.lastUsedAt?.getTime()).toBe(t1.getTime())
    })
  })

  it('lists all keys for owners and only own keys for editors, newest first, without revoked keys', async () => {
    await withKeyWorld(async (w) => {
      const t = Date.now()
      const hours = (n: number) => new Date(t - n * 60 * 60 * 1000)
      const ownerKey = await w.create(w.owner, 'owner', {
        name: 'Owner key',
        now: hours(3),
      })
      const editorKey = await w.create(w.editor, 'editor', {
        name: 'Editor key',
        now: hours(2),
      })
      // Created 60 days ago with a 30-day life: expired, but still listed.
      const expired = await w.create(w.editor, 'editor', {
        name: 'Expired key',
        expiresInDays: 30,
        now: new Date(t - 60 * DAY),
      })
      const revoked = await w.create(w.editor, 'editor', {
        name: 'Revoked key',
        now: hours(1),
      })
      await revokeMcpKey({
        id: revoked.key.id,
        siteId: w.site.id,
        actorId: w.editor,
        organizationId: w.org.id,
        canRevokeOthers: false,
      })

      const asOwner = await listMcpKeys({
        siteId: w.site.id,
        userId: w.owner,
        includeAllUsers: true,
      })
      expect(asOwner.map((k) => k.id)).toEqual([
        editorKey.key.id,
        ownerKey.key.id,
        expired.key.id,
      ])
      expect(asOwner.map((k) => k.userName)).toEqual(['editor', 'Test Actor', 'editor'])
      expect(asOwner.find((k) => k.id === expired.key.id)?.expiresAt).not.toBeNull()

      const asEditor = await listMcpKeys({
        siteId: w.site.id,
        userId: w.editor,
        includeAllUsers: false,
      })
      expect(asEditor.map((k) => k.name)).toEqual(['Editor key', 'Expired key'])
    })
  })

  it('lets editors revoke only their own keys and owners revoke any, auditing the revoke', async () => {
    await withKeyWorld(async (w) => {
      const editorKey = await w.create(w.editor, 'editor')
      const ownerKey = await w.create(w.owner, 'owner')

      await expect(
        revokeMcpKey({
          id: ownerKey.key.id,
          siteId: w.site.id,
          actorId: w.editor,
          organizationId: w.org.id,
          canRevokeOthers: false,
        }),
      ).rejects.toBeInstanceOf(NotFoundError)

      await revokeMcpKey({
        id: editorKey.key.id,
        siteId: w.site.id,
        actorId: w.editor,
        organizationId: w.org.id,
        canRevokeOthers: false,
      })
      expect(await resolveMcpActor(editorKey.token)).toBeNull()

      await revokeMcpKey({
        id: ownerKey.key.id,
        siteId: w.site.id,
        actorId: w.owner,
        organizationId: w.org.id,
        canRevokeOthers: true,
      })
      expect(await resolveMcpActor(ownerKey.token)).toBeNull()

      const entries = await db
        .select()
        .from(auditLog)
        .where(eq(auditLog.targetId, editorKey.key.id))
      expect(entries.map((e) => e.action).sort()).toEqual([
        'mcp_key.create',
        'mcp_key.revoke',
      ])
    })
  })

  it('answers NotFound for a key on another site', async () => {
    await withKeyWorld(async (w) => {
      const { key } = await w.create(w.owner, 'owner')
      await expect(
        revokeMcpKey({
          id: key.id,
          siteId: crypto.randomUUID(),
          actorId: w.owner,
          organizationId: w.org.id,
          canRevokeOthers: true,
        }),
      ).rejects.toBeInstanceOf(NotFoundError)
    })
  })

  it('caps active keys at 20 per user per site; revoking one frees a slot', async () => {
    await withKeyWorld(async (w) => {
      const keys = []
      for (let i = 0; i < 20; i++) {
        keys.push(await w.create(w.editor, 'editor', { name: `Key ${i}` }))
      }
      await expect(w.create(w.editor, 'editor')).rejects.toBeInstanceOf(ConflictError)

      // Other users are not affected by this user's cap.
      await expect(w.create(w.owner, 'owner')).resolves.toBeDefined()

      await revokeMcpKey({
        id: keys[0].key.id,
        siteId: w.site.id,
        actorId: w.editor,
        organizationId: w.org.id,
        canRevokeOthers: false,
      })
      await expect(w.create(w.editor, 'editor')).resolves.toBeDefined()
    })
  })
})
