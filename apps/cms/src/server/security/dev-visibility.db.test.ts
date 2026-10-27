/* eslint-disable @typescript-eslint/no-unnecessary-condition -- row lookups after .returning()/.select() are checked defensively */
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { db } from '#/db'
import { auditLog, mcpConnection, oauthClient, site } from '#/db/schema'
import { m } from '#/paraglide/messages'
import { changeSiteSlug, createSite, updateSite } from '#/server/admin/sites'
import { listAuditLog } from '#/server/admin/audit'
import { getHomeActivityFn } from '#/server/fn/home'
import { getMeFn } from '#/server/fn/me'
import { getSitesOverviewFn } from '#/server/fn/overview'
import { getSiteFn, listAuditLogFn } from '#/server/fn/admin'
import { listEntriesFn } from '#/server/fn/content'
import { updateAssetFn } from '#/server/fn/assets'
import { listMcpKeysFn } from '#/server/fn/mcp-keys'
import { requestPublicationFn } from '#/server/fn/publishing'
import { ConflictError } from '#/server/content/errors'
import { createEntry, scheduleEntry } from '#/server/content/entries'
import {
  createTestCollection,
  sampleRichText,
} from '#/server/content/test-utils'
import { createMcpKey } from '#/server/mcp/keys'
import { mcpResourceUrl } from '#/server/mcp/oauth-resource'
import { handleSiteMcpRequest } from '#/server/mcp/http'
import {
  requestPublication,
  requestRollback,
} from '#/server/publishing/publications'
import { requireMcpSiteAccess } from '#/server/mcp/site-access'

import { setCurrentSession } from './authz-state'
import type { TestSession } from './authz-state'
import {
  callServerFn,
  classify,
  isServerFn,
  outcomeLabel,
  seedWorld,
} from './authz-harness'
import type { World } from './authz-harness'
import { isDevSite, assertSiteVisibleTo } from './site-visibility'

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

vi.mock('#/lib/auth', async () => (await import('./authz-state')).fakeAuth())
vi.mock('#/server/mcp/oauth-tokens', () => ({
  verifyMcpAccessToken: async () => verdict.value ?? { ok: false },
}))
vi.mock('@tanstack/react-start/server', () => ({
  getRequestHeaders: () => new Headers(),
  getCookie: () => null,
}))
vi.mock('@tanstack/react-start', async (importOriginal) =>
  (await import('./authz-start-patch')).patchStart(await importOriginal()),
)

const dbName = (() => {
  try {
    return new URL(process.env.DATABASE_URL ?? '').pathname.slice(1)
  } catch {
    return ''
  }
})()
// Same rule as authz-matrix.test.ts: never run against a developer database.
const runnable = /authz|test|e2e|bench|tmp/i.test(dbName)

/** Runs a server function as the transport would, as the given session. */
function runAs(fn: unknown, data: unknown, session: TestSession) {
  if (!isServerFn(fn)) throw new Error('expected a server function')
  return callServerFn(fn, data, session)
}

const future = () => new Date(Date.now() + 86_400_000).toISOString()

describe.skipIf(!runnable)(
  'development environments are hidden from clients',
  () => {
    // Filled in beforeAll; the production site is World.X.site.
    let world: World
    let dev: typeof site.$inferSelect
    const oauthClientId = `dev-vis-${crypto.randomUUID()}`

    beforeAll(async () => {
      world = await seedWorld()
      const prod = world.X.site
      const suffix = crypto.randomUUID().slice(0, 8)
      const [row] = await db
        .insert(site)
        .values({
          organizationId: prod.organizationId,
          name: `Dev site ${suffix} (dev)`,
          slug: `${prod.slug}-dev`,
          tokenHash: `h-${crypto.randomUUID()}`,
          schemaTokenHash: `s-${crypto.randomUUID()}`,
          productionUrl: 'http://localhost:3000',
          previewSecret: crypto.randomUUID(),
          publishingMode: 'demo',
          deploymentTarget: null,
          environment: 'development',
          parentSiteId: prod.id,
        })
        .returning()
      if (!row) throw new Error('dev site insert failed')
      dev = row
      await createTestCollection(dev.id)
      await createEntry({
        siteId: dev.id,
        collectionKey: 'articles',
        data: {
          title: 'Dev draft',
          slug: `dev-${suffix}`,
          body: sampleRichText,
        },
        actorId: world.users.adminMfa.id,
      })
      await db.insert(oauthClient).values({
        id: crypto.randomUUID(),
        clientId: oauthClientId,
        redirectUris: ['http://localhost/callback'],
      })
    })

    afterAll(async () => {
      setCurrentSession(null)
      await db
        .delete(oauthClient)
        .where(eq(oauthClient.clientId, oauthClientId))
      await world.destroy()
    })

    describe('the visibility rule', () => {
      it('recognises a development environment by its environment column', () => {
        expect(isDevSite({ environment: 'development' })).toBe(true)
        expect(isDevSite({ environment: 'production' })).toBe(false)
      })

      it('lets agency admins with MFA through and refuses everyone else with NotFound', async () => {
        await expect(
          assertSiteVisibleTo(world.sessions.adminMfa!, dev),
        ).resolves.toBeUndefined()
        await expect(
          assertSiteVisibleTo(world.sessions.ownerX!, dev),
        ).rejects.toMatchObject({ status: 404 })
        await expect(
          assertSiteVisibleTo(world.sessions.adminNoMfa!, dev),
        ).rejects.toMatchObject({ status: 404 })
        // A production site is never hidden by this rule.
        await expect(
          assertSiteVisibleTo(world.sessions.ownerX!, world.X.site),
        ).resolves.toBeUndefined()
      })
    })

    describe('site-scoped server functions', () => {
      it('answer NotFound to a client owner and a client editor', async () => {
        const cases: Array<{
          name: string
          run: (
            session: NonNullable<World['sessions']['ownerX']>,
          ) => Promise<{ error?: unknown }>
        }> = [
          {
            name: 'content: listEntriesFn',
            run: (session) =>
              runAs(
                listEntriesFn,
                { siteId: dev.id, collectionKey: 'articles' },
                session,
              ),
          },
          {
            name: 'publishing: requestPublicationFn',
            run: (session) =>
              runAs(
                requestPublicationFn,
                { siteId: dev.id, requestKey: crypto.randomUUID() },
                session,
              ),
          },
          {
            name: 'assets: updateAssetFn with the dev siteId',
            run: (session) =>
              runAs(
                updateAssetFn,
                {
                  id: world.X.asset.id,
                  altText: 'changed',
                  locale: undefined,
                  siteId: dev.id,
                },
                session,
              ),
          },
          {
            name: 'Connect AI: listMcpKeysFn',
            run: (session) => runAs(listMcpKeysFn, { siteId: dev.id }, session),
          },
        ]

        for (const { name, run } of cases) {
          const editor = await run(world.sessions.editorX!)
          const owner = await run(world.sessions.ownerX!)
          expect(classify(editor.error), `${name} as editor`).toBe('not-found')
          expect(classify(owner.error), `${name} as owner`).toBe('not-found')
        }
      })

      it('does not show the dev site to a client through the admin site lookup', async () => {
        // The admin site functions are agency-only already, so a client is
        // refused before the visibility rule runs. Both refusals are checked.
        const client = await runAs(
          getSiteFn,
          { id: dev.id },
          world.sessions.ownerX,
        )
        expect(outcomeLabel(client, false)).toBe('forbidden')
        const admin = await runAs(
          getSiteFn,
          { id: dev.id },
          world.sessions.adminMfa,
        )
        expect(outcomeLabel(admin, false)).toBe('allowed')
      })

      it('lets an agency admin with MFA pass the content and Connect AI checks', async () => {
        const entries = await runAs(
          listEntriesFn,
          { siteId: dev.id, collectionKey: 'articles' },
          world.sessions.adminMfa,
        )
        expect(outcomeLabel(entries, false)).toBe('allowed')

        const keys = await runAs(
          listMcpKeysFn,
          { siteId: dev.id },
          world.sessions.adminMfa,
        )
        expect(outcomeLabel(keys, false)).toBe('allowed')
      })
    })

    describe('MCP site access', () => {
      it('requireMcpSiteAccess answers NotFound to a client and passes an admin', async () => {
        setCurrentSession(world.sessions.ownerX)
        await expect(requireMcpSiteAccess(dev.id)).rejects.toMatchObject({
          status: 404,
        })
        setCurrentSession(world.sessions.adminMfa)
        const access = await requireMcpSiteAccess(dev.id)
        expect(access.role).toBe('agency')
        setCurrentSession(null)
      })
    })

    describe('handleSiteMcpRequest', () => {
      const ping = (slug: string, authorization: string) =>
        new Request(mcpResourceUrl(slug), {
          method: 'POST',
          headers: {
            authorization,
            'content-type': 'application/json',
            accept: 'application/json, text/event-stream',
          },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
        })

      it('answers a personal key for a dev site NotFound for a client, and serves an admin', async () => {
        const clientKey = await createMcpKey({
          userId: world.users.ownerX.id,
          siteId: dev.id,
          organizationId: dev.organizationId,
          name: 'owner key',
          expiresInDays: 30,
          allowGoLive: false,
          role: 'owner',
        })
        const clientResponse = await handleSiteMcpRequest(
          ping(dev.slug, `Bearer ${clientKey.token}`),
          dev.slug,
        )
        expect(clientResponse.status).toBe(404)
        expect(await clientResponse.json()).toEqual({ error: 'Site not found' })

        const adminKey = await createMcpKey({
          userId: world.users.adminMfa.id,
          siteId: dev.id,
          organizationId: dev.organizationId,
          name: 'admin key',
          expiresInDays: 30,
          allowGoLive: false,
          role: 'agency',
        })
        const adminResponse = await handleSiteMcpRequest(
          ping(dev.slug, `Bearer ${adminKey.token}`),
          dev.slug,
        )
        expect(adminResponse.status).not.toBe(404)
      })

      it('answers an app connection to a dev site NotFound for a client, and serves an admin', async () => {
        const connectionFor = async (userId: string) => {
          const [row] = await db
            .insert(mcpConnection)
            .values({
              userId,
              siteId: dev.id,
              clientId: oauthClientId,
              clientName: 'Assistant',
              allowGoLive: false,
            })
            .returning()
          if (!row) throw new Error('connection insert failed')
          return row
        }
        const clientConnection = await connectionFor(world.users.ownerX.id)
        verdict.value = {
          ok: true,
          token: {
            userId: world.users.ownerX.id,
            clientId: oauthClientId,
            connectionId: clientConnection.id,
            resources: [mcpResourceUrl(dev.slug)],
            scopes: ['mcp'],
          },
        }
        const clientResponse = await handleSiteMcpRequest(
          ping(dev.slug, 'Bearer areca_at_test'),
          dev.slug,
        )
        expect(clientResponse.status).toBe(404)

        const adminConnection = await connectionFor(world.users.adminMfa.id)
        verdict.value = {
          ok: true,
          token: {
            userId: world.users.adminMfa.id,
            clientId: oauthClientId,
            connectionId: adminConnection.id,
            resources: [mcpResourceUrl(dev.slug)],
            scopes: ['mcp'],
          },
        }
        const adminResponse = await handleSiteMcpRequest(
          ping(dev.slug, 'Bearer areca_at_test'),
          dev.slug,
        )
        expect(adminResponse.status).not.toBe(404)
        verdict.value = null
      })
    })

    describe('the site list (me.ts)', () => {
      it('hides the dev site from a client and shows it to an admin', async () => {
        const client = await runAs(getMeFn, undefined, world.sessions.ownerX)
        const clientSites = (client.result as { sites: { id: string }[] }).sites
        expect(clientSites.map((row) => row.id)).not.toContain(dev.id)
        expect(clientSites.map((row) => row.id)).toContain(world.X.site.id)

        const admin = await runAs(getMeFn, undefined, world.sessions.adminMfa)
        const adminSites = (
          admin.result as {
            sites: {
              id: string
              environment: string
              parentSiteId: string | null
            }[]
          }
        ).sites
        const adminDev = adminSites.find((row) => row.id === dev.id)
        expect(adminDev).toMatchObject({
          environment: 'development',
          parentSiteId: world.X.site.id,
        })
        expect(
          adminSites.find((row) => row.id === world.X.site.id),
        ).toMatchObject({ environment: 'production', parentSiteId: null })
      })
    })

    describe('activity and counts', () => {
      it('keeps dev audit rows and dev_env actions away from clients', async () => {
        const [devRow] = await db
          .insert(auditLog)
          .values({
            organizationId: dev.organizationId,
            siteId: dev.id,
            actorId: world.users.adminMfa.id,
            action: 'authz.dev.marker',
            targetType: 'site',
            targetId: dev.id,
            meta: null,
          })
          .returning()
        const [forkRow] = await db
          .insert(auditLog)
          .values({
            organizationId: dev.organizationId,
            siteId: world.X.site.id,
            actorId: world.users.adminMfa.id,
            action: 'dev_env.fork',
            targetType: 'site',
            targetId: dev.id,
            meta: null,
          })
          .returning()
        expect(devRow).toBeDefined()
        expect(forkRow).toBeDefined()

        const clientLog = await runAs(
          listAuditLogFn,
          { organizationId: dev.organizationId, limit: 100, offset: 0 },
          world.sessions.ownerX,
        )
        const clientIds = (clientLog.result as { id: string }[]).map(
          (row) => row.id,
        )
        expect(clientIds).not.toContain(devRow.id)
        expect(clientIds).not.toContain(forkRow.id)

        const adminLog = await runAs(
          listAuditLogFn,
          { organizationId: dev.organizationId, limit: 100, offset: 0 },
          world.sessions.adminMfa,
        )
        const adminIds = (adminLog.result as { id: string }[]).map(
          (row) => row.id,
        )
        expect(adminIds).toContain(devRow.id)
        expect(adminIds).toContain(forkRow.id)

        // The shared query helper keeps the same split when called directly.
        const direct = await listAuditLog({
          organizationId: dev.organizationId,
          limit: 200,
          offset: 0,
          includeDevEnvs: false,
        })
        expect(direct.map((row) => row.id)).not.toContain(devRow.id)

        const home = await runAs(
          getHomeActivityFn,
          undefined,
          world.sessions.ownerX,
        )
        const homeRows = (
          home.result as { activity: { siteId: string | null }[] }
        ).activity
        expect(homeRows.filter((row) => row.siteId === dev.id)).toHaveLength(0)
      })

      it('counts production sites only in the sites overview', async () => {
        for (const session of [
          world.sessions.ownerX!,
          world.sessions.adminMfa!,
        ]) {
          const overview = await runAs(getSitesOverviewFn, undefined, session)
          const ids = (
            overview.result as { sites: { id: string }[] }
          ).sites.map((row) => row.id)
          expect(ids).toContain(world.X.site.id)
          expect(ids).not.toContain(dev.id)
        }
      })
    })

    describe('guards on a development environment', () => {
      const refusal = async (promise: Promise<unknown>, message: string) => {
        const error = await promise.then(
          () => null,
          (caught: unknown) => caught,
        )
        expect(error).toBeInstanceOf(ConflictError)
        expect((error as Error).message).toBe(message)
      }

      it('updateSite refuses Production mode and a deployment target, but allows the preview URL', async () => {
        const actorId = world.users.adminMfa.id
        await refusal(
          updateSite(dev.id, { publishingMode: 'production' }, actorId),
          m.server_dev_env_stays_demo(),
        )
        await refusal(
          updateSite(
            dev.id,
            {
              deploymentTarget: {
                provider: 'dokploy',
                applicationId: 'app-1',
                healthCheckUrl: 'https://example.com/health',
              },
            },
            actorId,
          ),
          m.server_dev_env_stays_demo(),
        )
        const updated = await updateSite(
          dev.id,
          { productionUrl: 'http://localhost:4123' },
          actorId,
        )
        expect(updated.productionUrl).toBe('http://localhost:4123')
        expect(updated.publishingMode).toBe('demo')
      })

      it('requestPublication and requestRollback refuse with the no-releases message', async () => {
        const actorId = world.users.adminMfa.id
        await refusal(
          requestPublication({ siteId: dev.id, actorId }),
          m.server_dev_env_no_releases(),
        )
        await refusal(
          requestRollback({
            siteId: dev.id,
            publicationId: crypto.randomUUID(),
            actorId,
          }),
          m.server_dev_env_no_releases(),
        )
      })

      it('scheduleEntry refuses on a dev env', async () => {
        const created = await createEntry({
          siteId: dev.id,
          collectionKey: 'articles',
          data: {
            title: 'Scheduled?',
            slug: `sched-${crypto.randomUUID().slice(0, 6)}`,
            body: sampleRichText,
          },
          actorId: world.users.adminMfa.id,
        })
        await refusal(
          scheduleEntry(created.id, future(), 'UTC', world.users.adminMfa.id),
          m.server_dev_env_no_scheduling(),
        )
      })

      it('changeSiteSlug refuses on a dev env', async () => {
        await refusal(
          changeSiteSlug(
            dev.id,
            `renamed-${crypto.randomUUID().slice(0, 8)}`,
            world.users.adminMfa.id,
          ),
          m.server_dev_env_slug_follows_production(),
        )
      })

      it('changeSiteSlug on a production site renames its dev env, or refuses when the new dev slug is taken', async () => {
        const actorId = world.users.adminMfa.id
        const prod = world.Y.site
        // Dev env for the other tenant's production site, so the rename is isolated.
        const suffix = crypto.randomUUID().slice(0, 8)
        const [otherDev] = await db
          .insert(site)
          .values({
            organizationId: prod.organizationId,
            name: 'Other dev',
            slug: `${prod.slug}-dev`,
            tokenHash: `h-${crypto.randomUUID()}`,
            schemaTokenHash: `s-${crypto.randomUUID()}`,
            productionUrl: 'http://localhost:3000',
            previewSecret: crypto.randomUUID(),
            publishingMode: 'demo',
            environment: 'development',
            parentSiteId: prod.id,
          })
          .returning()
        if (!otherDev) throw new Error('dev insert failed')

        const renamed = `moved-${suffix}`
        const updatedProd = await changeSiteSlug(prod.id, renamed, actorId)
        expect(updatedProd.slug).toBe(renamed)
        const [renamedDev] = await db
          .select({ slug: site.slug })
          .from(site)
          .where(eq(site.id, otherDev.id))
        expect(renamedDev?.slug).toBe(`${renamed}-dev`)

        // Taken: a free production slug whose dev slug is already in use.
        const blocker = `blocked-${suffix}`
        await db.insert(site).values({
          organizationId: prod.organizationId,
          name: 'Blocker',
          slug: `${blocker}-dev`,
          tokenHash: `h-${crypto.randomUUID()}`,
          schemaTokenHash: `s-${crypto.randomUUID()}`,
          productionUrl: 'http://localhost:3000',
          previewSecret: crypto.randomUUID(),
          publishingMode: 'demo',
        })
        await refusal(
          changeSiteSlug(prod.id, blocker, actorId),
          m.server_dev_env_slug_taken({ slug: `${blocker}-dev` }),
        )
        const [stillRenamed] = await db
          .select({ slug: site.slug })
          .from(site)
          .where(eq(site.id, prod.id))
        expect(stillRenamed?.slug).toBe(renamed)
      })

      it('createSite says a slug belonging to a dev env is a development environment slug', async () => {
        await refusal(
          createSite({
            organizationId: dev.organizationId,
            name: 'Clash',
            slug: dev.slug,
            productionUrl: 'https://clash.example.com',
            actorId: world.users.adminMfa.id,
          }),
          m.server_slug_belongs_to_dev_env(),
        )
      })
    })
  },
)
