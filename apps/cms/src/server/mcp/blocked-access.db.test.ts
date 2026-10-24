/* eslint-disable @typescript-eslint/no-unnecessary-condition -- row lookups after .select() are checked defensively */
import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { db } from '#/db'
import { mcpConnection, membership, oauthClient, user } from '#/db/schema'
import { cleanupTestSite, createTestSite } from '#/server/content/test-utils'
import { liveRoleFor } from '#/server/mcp/keys'
import { mcpResourceUrl } from '#/server/mcp/oauth-resource'
import { blockUser, unblockUser } from '#/server/admin/users'

import { handleSiteMcpRequest } from './http'

// The OAuth token check is the authorization server's job and is covered by
// oauth-flow.test.ts. Here the token is taken as valid for this connection,
// so the test reaches the owner gate that suspension has to close.
const verdict = vi.hoisted(() => ({
  value: null as null | {
    ok: true
    token: {
      userId: string
      clientId: string
      connectionId: string
      resources: string[]
      scopes: string[]
    }
  },
}))

vi.mock('#/server/mcp/oauth-tokens', () => ({
  verifyMcpAccessToken: async () => verdict.value ?? { ok: false },
}))

const hasDb = Boolean(process.env.DATABASE_URL)

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.()
  verdict.value = null
})

async function fixture() {
  const ctx = await createTestSite()
  const owner = (
    await db
      .insert(user)
      .values({
        id: crypto.randomUUID(),
        name: 'Ada Connected',
        email: `ada-${crypto.randomUUID()}@areca.test`,
        emailVerified: true,
      })
      .returning()
  )[0]
  if (!owner) throw new Error('fixture failed')
  const clientId = `app-${crypto.randomUUID()}`
  await db.insert(oauthClient).values({
    id: crypto.randomUUID(),
    clientId,
    redirectUris: ['http://localhost/callback'],
  })
  const [connection] = await db
    .insert(mcpConnection)
    .values({
      userId: owner.id,
      siteId: ctx.site.id,
      clientId,
      clientName: 'Assistant',
      allowGoLive: false,
    })
    .returning()
  await db
    .insert(membership)
    .values({ userId: owner.id, organizationId: ctx.org.id, role: 'editor' })
  if (!connection) throw new Error('fixture failed')
  verdict.value = {
    ok: true,
    token: {
      userId: owner.id,
      clientId,
      connectionId: connection.id,
      resources: [mcpResourceUrl(ctx.site.slug)],
      scopes: ['mcp'],
    },
  }
  cleanups.push(async () => {
    await cleanupTestSite(ctx)
    await db.delete(user).where(eq(user.id, owner.id))
    await db.delete(oauthClient).where(eq(oauthClient.clientId, clientId))
  })
  // The block is an admin action; the domain does not check the actor's role.
  return { ...ctx, owner, actor: ctx.actor, connection }
}

function mcpRequest(slug: string) {
  return new Request(mcpResourceUrl(slug), {
    method: 'POST',
    headers: {
      authorization: 'Bearer areca_at_test',
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
  })
}

describe.skipIf(!hasDb)('suspended people and their app connections', () => {
  it('an app connection of a blocked person is refused at the MCP endpoint, and works again once unblocked', async () => {
    const fx = await fixture()

    const before = await handleSiteMcpRequest(
      mcpRequest(fx.site.slug),
      fx.site.slug,
    )
    expect(before.status).not.toBe(401)

    await blockUser({ actorId: fx.actor.id, userId: fx.owner.id })
    const blocked = await handleSiteMcpRequest(
      mcpRequest(fx.site.slug),
      fx.site.slug,
    )
    expect(blocked.status).toBe(401)
    expect(blocked.headers.get('www-authenticate')).toContain('invalid_token')

    // Suspended, not revoked: the connection row is still usable.
    const [row] = await db
      .select()
      .from(mcpConnection)
      .where(eq(mcpConnection.id, fx.connection.id))
    expect(row?.revokedAt).toBeNull()

    await unblockUser({ actorId: fx.actor.id, userId: fx.owner.id })
    const after = await handleSiteMcpRequest(
      mcpRequest(fx.site.slug),
      fx.site.slug,
    )
    expect(after.status).not.toBe(401)
  })

  it('live role lookup treats a blocked person as having no access, whatever their role', async () => {
    const fx = await fixture()
    await blockUser({ actorId: fx.actor.id, userId: fx.owner.id })
    const [owner] = await db.select().from(user).where(eq(user.id, fx.owner.id))
    expect(
      await liveRoleFor(
        {
          id: fx.owner.id,
          isAgencyAdmin: false,
          twoFactorEnabled: false,
          blockedAt: owner?.blockedAt ?? null,
        },
        fx.org.id,
      ),
    ).toEqual({ ok: false, reason: 'invalid' })
  })
})
