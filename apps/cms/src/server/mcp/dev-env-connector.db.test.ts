/* eslint-disable @typescript-eslint/no-unnecessary-condition -- row lookups after .returning() are checked defensively */
import { and, eq, isNull } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { db } from '#/db'
import { mcpConnection, oauthClient } from '#/db/schema'
import { createSite, deleteSite } from '#/server/admin/sites'
import { forkDevEnvironment } from '#/server/dev-env/fork'
import { seedWorld } from '#/server/security/authz-harness'
import type { World } from '#/server/security/authz-harness'
import { setCurrentSession } from '#/server/security/authz-state'
import { createMcpKey } from './keys'
import { handleDiscoveryRequest } from './discovery'
import { handleSiteMcpRequest, protectedResourceMetadataUrl } from './http'
import { mcpResourceUrl } from './oauth-resource'

// Must run before `#/env` is first imported: guards read ADMIN_MFA_REQUIRED.
vi.hoisted(() => {
  process.env.ADMIN_MFA_REQUIRED = 'true'
})
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

vi.mock('#/lib/auth', async () => {
  const fake = (await import('../security/authz-state')).fakeAuth()
  return {
    auth: {
      api: {
        ...fake.auth.api,
        getOAuthServerConfig: async () => ({
          issuer: `${process.env.BETTER_AUTH_URL ?? 'http://localhost:3000'}/api/auth`,
        }),
      },
    },
  }
})
vi.mock('./oauth-tokens', () => ({
  verifyMcpAccessToken: async () => verdict.value ?? { ok: false },
}))
vi.mock('@tanstack/react-start/server', () => ({
  getRequestHeaders: () => new Headers(),
  getCookie: () => null,
}))

const dbName = (() => {
  try {
    return new URL(process.env.DATABASE_URL ?? '').pathname.slice(1)
  } catch {
    return ''
  }
})()
// Same rule as the other authorization suites: never run against a developer database.
const runnable = /authz|test|e2e|bench|tmp/i.test(dbName)

const ping = (slug: string, authorization?: string) =>
  new Request(mcpResourceUrl(slug), {
    method: 'POST',
    headers: {
      ...(authorization ? { authorization } : {}),
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
  })

/**
 * Everything a caller can see of a response. A dev env refusal must match a
 * missing slug in all of it, so the two cannot be told apart.
 */
async function visible(response: Response) {
  return {
    status: response.status,
    contentType: response.headers.get('content-type'),
    authenticate: response.headers.get('www-authenticate'),
    body: await response.text(),
  }
}

describe.skipIf(!runnable)(
  'the dev env MCP connector and discovery (Decision 3, #7)',
  () => {
    let world: World
    let prodId: string
    let prodName: string
    let prodSlug: string
    let devId: string
    let devSlug: string
    const oauthClientId = `dev-connector-${crypto.randomUUID()}`
    const origin = () => new URL(mcpResourceUrl('x')).origin

    beforeAll(async () => {
      world = await seedWorld()
      await db.insert(oauthClient).values({
        id: crypto.randomUUID(),
        clientId: oauthClientId,
        redirectUris: ['http://localhost/callback'],
      })
      // A fresh production site in org X, so its dev slug is known here.
      const suffix = crypto.randomUUID().slice(0, 8)
      prodSlug = `connector-${suffix}`
      prodName = `Connector ${suffix}`
      const prod = await createSite({
        organizationId: world.X.org.id,
        name: prodName,
        slug: prodSlug,
        productionUrl: 'https://connector.example.com',
        actorId: world.users.adminMfa.id,
      })
      const fork = await forkDevEnvironment(
        { id: world.users.adminMfa.id },
        prod.id,
      )
      prodId = prod.id
      devId = fork.id
      devSlug = fork.slug
    })

    afterAll(async () => {
      setCurrentSession(null)
      verdict.value = null
      await deleteSite(prodId, world.users.adminMfa.id)
      await db
        .delete(oauthClient)
        .where(eq(oauthClient.clientId, oauthClientId))
      await world.destroy()
    })

    describe('discovery', () => {
      const discover = (slug: string) =>
        handleDiscoveryRequest(
          new Request(
            `${origin()}/.well-known/oauth-protected-resource${new URL(mcpResourceUrl(slug)).pathname}`,
          ),
        )

      it('keeps the dev env discoverable for OAuth, under a generic name and not cached', async () => {
        const response = await discover(devSlug)
        expect(response?.status).toBe(200)
        expect(response?.headers.get('cache-control')).toBe('no-store')
        const body = (await response?.json()) as Record<string, unknown>
        expect(body.resource).toBe(mcpResourceUrl(devSlug))
        expect(body.resource_name).toBe('Areca site')
        expect(JSON.stringify(body)).not.toContain(prodName)
      })

      it('keeps the production name and public caching for a production site', async () => {
        const response = await discover(prodSlug)
        expect(response?.status).toBe(200)
        expect(response?.headers.get('cache-control')).toBe(
          'public, max-age=300',
        )
        const body = (await response?.json()) as { resource_name: string }
        expect(body.resource_name).toBe(`${prodName} (Areca CMS)`)
      })
    })

    describe('unauthenticated and invalid credentials', () => {
      it('answers an unauthenticated request with the 401 challenge, pointing at the generic metadata', async () => {
        const response = await handleSiteMcpRequest(ping(devSlug), devSlug)
        expect(response.status).toBe(401)
        expect(response.headers.get('www-authenticate')).toContain(
          `resource_metadata="${protectedResourceMetadataUrl(devSlug)}"`,
        )
      })

      it('answers an invalid personal key with the 401, not NotFound', async () => {
        const response = await handleSiteMcpRequest(
          ping(devSlug, `Bearer areca_mcp_${'0'.repeat(40)}`),
          devSlug,
        )
        expect(response.status).toBe(401)
      })
    })

    describe('authenticated callers who are not agency admins get the missing-slug 404', () => {
      it('a personal key bound to another site', async () => {
        const key = await createMcpKey({
          userId: world.users.ownerX.id,
          siteId: world.X.site.id,
          organizationId: world.X.org.id,
          name: 'owner prod key',
          expiresInDays: 30,
          allowGoLive: false,
          role: 'owner',
        })
        const onDev = await handleSiteMcpRequest(
          ping(devSlug, `Bearer ${key.token}`),
          devSlug,
        )
        const missing = `connector-missing-${crypto.randomUUID().slice(0, 8)}`
        const onMissing = await handleSiteMcpRequest(
          ping(missing, `Bearer ${key.token}`),
          missing,
        )
        expect(onDev.status).toBe(404)
        expect(await visible(onDev)).toEqual(await visible(onMissing))
      })

      it('a personal key for the dev env itself', async () => {
        const key = await createMcpKey({
          userId: world.users.ownerX.id,
          siteId: devId,
          organizationId: world.X.org.id,
          name: 'owner dev key',
          expiresInDays: 30,
          allowGoLive: false,
          role: 'owner',
        })
        const onDev = await handleSiteMcpRequest(
          ping(devSlug, `Bearer ${key.token}`),
          devSlug,
        )
        const missing = `connector-missing-${crypto.randomUUID().slice(0, 8)}`
        const onMissing = await handleSiteMcpRequest(
          ping(missing, `Bearer ${key.token}`),
          missing,
        )
        expect(await visible(onDev)).toEqual(await visible(onMissing))
      })

      it('an OAuth token whose resource is another site', async () => {
        const connection = await insertConnection(
          world.users.ownerX.id,
          devId,
          oauthClientId,
        )
        verdict.value = {
          ok: true,
          token: {
            userId: world.users.ownerX.id,
            clientId: oauthClientId,
            connectionId: connection.id,
            resources: [mcpResourceUrl(prodSlug)],
            scopes: ['mcp'],
          },
        }
        const onDev = await handleSiteMcpRequest(
          ping(devSlug, 'Bearer areca_at_test'),
          devSlug,
        )
        const missing = `connector-missing-${crypto.randomUUID().slice(0, 8)}`
        const onMissing = await handleSiteMcpRequest(
          ping(missing, 'Bearer areca_at_test'),
          missing,
        )
        expect(await visible(onDev)).toEqual(await visible(onMissing))
        verdict.value = null
      })

      it('an OAuth token without the MCP scope, and one for a connection that is gone', async () => {
        const connection = await insertConnection(
          world.users.ownerX.id,
          devId,
          oauthClientId,
        )
        const missing = `connector-missing-${crypto.randomUUID().slice(0, 8)}`
        const onMissing = await visible(
          await handleSiteMcpRequest(
            ping(missing, 'Bearer areca_at_test'),
            missing,
          ),
        )

        verdict.value = {
          ok: true,
          token: {
            userId: world.users.ownerX.id,
            clientId: oauthClientId,
            connectionId: connection.id,
            resources: [mcpResourceUrl(devSlug)],
            scopes: [],
          },
        }
        expect(
          await visible(
            await handleSiteMcpRequest(
              ping(devSlug, 'Bearer areca_at_test'),
              devSlug,
            ),
          ),
        ).toEqual(onMissing)

        verdict.value = {
          ok: true,
          token: {
            userId: world.users.ownerX.id,
            clientId: oauthClientId,
            connectionId: crypto.randomUUID(),
            resources: [mcpResourceUrl(devSlug)],
            scopes: ['mcp'],
          },
        }
        expect(
          await visible(
            await handleSiteMcpRequest(
              ping(devSlug, 'Bearer areca_at_test'),
              devSlug,
            ),
          ),
        ).toEqual(onMissing)
        verdict.value = null
      })
    })

    describe('agency admins keep the normal behaviour', () => {
      it('a personal key for the dev env serves the connector', async () => {
        const key = await createMcpKey({
          userId: world.users.adminMfa.id,
          siteId: devId,
          organizationId: world.X.org.id,
          name: 'admin dev key',
          expiresInDays: 30,
          allowGoLive: false,
          role: 'agency',
        })
        const response = await handleSiteMcpRequest(
          ping(devSlug, `Bearer ${key.token}`),
          devSlug,
        )
        expect(response.status).toBe(200)
      })

      it('an OAuth connection to the dev env serves the connector', async () => {
        const connection = await insertConnection(
          world.users.adminMfa.id,
          devId,
          oauthClientId,
        )
        verdict.value = {
          ok: true,
          token: {
            userId: world.users.adminMfa.id,
            clientId: oauthClientId,
            connectionId: connection.id,
            resources: [mcpResourceUrl(devSlug)],
            scopes: ['mcp'],
          },
        }
        const response = await handleSiteMcpRequest(
          ping(devSlug, 'Bearer areca_at_test'),
          devSlug,
        )
        expect(response.status).toBe(200)
        verdict.value = null
      })

      it('an admin with a key for another site gets the same NotFound a client does', async () => {
        const key = await createMcpKey({
          userId: world.users.adminMfa.id,
          siteId: world.X.site.id,
          organizationId: world.X.org.id,
          name: 'admin prod key',
          expiresInDays: 30,
          allowGoLive: false,
          role: 'agency',
        })
        const response = await handleSiteMcpRequest(
          ping(devSlug, `Bearer ${key.token}`),
          devSlug,
        )
        const missing = `connector-missing-${crypto.randomUUID().slice(0, 8)}`
        expect(await visible(response)).toEqual(
          await visible(
            await handleSiteMcpRequest(
              ping(missing, `Bearer ${key.token}`),
              missing,
            ),
          ),
        )
      })
    })
  },
)

/** An active app connection, reused when the test already has one. */
async function insertConnection(
  userId: string,
  siteId: string,
  clientId: string,
) {
  const [existing] = await db
    .select()
    .from(mcpConnection)
    .where(
      and(
        eq(mcpConnection.userId, userId),
        eq(mcpConnection.siteId, siteId),
        eq(mcpConnection.clientId, clientId),
        isNull(mcpConnection.revokedAt),
      ),
    )
    .limit(1)
  if (existing) return existing
  const [row] = await db
    .insert(mcpConnection)
    .values({
      userId,
      siteId,
      clientId,
      clientName: 'Assistant',
      allowGoLive: false,
    })
    .returning()
  if (!row) throw new Error('connection insert failed')
  return row
}
