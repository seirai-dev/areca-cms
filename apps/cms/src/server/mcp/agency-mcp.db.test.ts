/* eslint-disable @typescript-eslint/no-unnecessary-condition -- row lookups after .returning()/.select() are checked defensively */
import { and, eq, inArray } from 'drizzle-orm'
import {
  Client,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { db } from '#/db'
import {
  auditLog,
  entry,
  membership,
  mcpConnection,
  mcpKey,
  oauthClient,
  site,
  user,
} from '#/db/schema'
import { deleteSite } from '#/server/admin/sites'
import { setAgencyAdmin } from '#/server/admin/members'
import { forkDevEnvironment } from '#/server/dev-env/fork'
import {
  cleanupTestSite,
  createTestCollection,
  createTestSite,
} from '#/server/content/test-utils'

import { handleAgencyMcpRequest } from './agency-http'
import { AGENCY_NAVIGATION } from './agency-navigation'
import { SITE_TOOLS } from './tool-catalog'
import {
  createAgencyMcpKey,
  createMcpKey,
  listAgencyMcpKeys,
  resolveAgencyPrincipal,
  revokeAgencyMcpKey,
} from './keys'
import { handleSiteMcpRequest } from './http'

vi.hoisted(() => {
  process.env.ADMIN_MFA_REQUIRED = 'true'
})

const dbName = (() => {
  try {
    return new URL(process.env.DATABASE_URL ?? '').pathname.slice(1)
  } catch {
    return ''
  }
})()
// Same rule as the other authorization suites: never run against a developer database.
const runnable = /authz|test|e2e|bench|tmp/i.test(dbName)

const AGENCY_URL = 'https://cms.test/api/agency/mcp'
const siteUrl = (slug: string) => `https://cms.test/api/mcp/${slug}`
const navigationNames = AGENCY_NAVIGATION.map((tool) => tool.name)

type Outcome = {
  isError: boolean
  text: string
  data: Record<string, unknown> | null
}

async function connectAgency(token: string) {
  const client = new Client({ name: 'agency-test', version: '1.0.0' })
  const transport = new StreamableHTTPClientTransport(new URL(AGENCY_URL), {
    fetch: (input, init) => handleAgencyMcpRequest(new Request(input, init)),
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  })
  await client.connect(transport)
  return client
}

async function connectSite(token: string, slug: string) {
  const client = new Client({ name: 'site-test', version: '1.0.0' })
  const transport = new StreamableHTTPClientTransport(new URL(siteUrl(slug)), {
    fetch: (input, init) =>
      handleSiteMcpRequest(new Request(input, init), slug),
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  })
  await client.connect(transport)
  return client
}

async function call(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
): Promise<Outcome> {
  const result = await client.callTool({ name, arguments: args })
  const first = result.content.at(0)
  const text = first?.type === 'text' ? first.text : ''
  let data: Record<string, unknown> | null = null
  if (!result.isError) {
    try {
      const parsed: unknown = JSON.parse(text)
      data =
        parsed && typeof parsed === 'object'
          ? (parsed as Record<string, unknown>)
          : null
    } catch {
      data = null
    }
  }
  return { isError: Boolean(result.isError), text, data }
}

function pingRequest(url: string, token?: string) {
  return new Request(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
  })
}

/** The text of a database error, including the Postgres error under drizzle's wrapper. */
async function databaseError(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
  } catch (error) {
    const cause = (error as { cause?: unknown }).cause
    return [(error as Error).message, (cause as Error | undefined)?.message]
      .filter(Boolean)
      .join(' | ')
  }
  throw new Error('expected the insert to fail')
}

/** Everything a caller can see of a response, for comparing two refusals. */
async function visible(response: Response) {
  return {
    status: response.status,
    body: await response.text(),
  }
}

describe.skipIf(!runnable)(
  'agency MCP connector (docs/design/agency-mcp.md)',
  () => {
    let clientX: Awaited<ReturnType<typeof createTestSite>>
    let clientY: Awaited<ReturnType<typeof createTestSite>>
    let admin: string
    let adminNoMfa: string
    let lapsed: string
    let demoted: string
    let editor: string
    let ownerX: string
    let devId: string
    let devSlug: string
    let agencyToken: string
    let siteKeyAdmin: string
    let siteKeyAdminNoFlag: string
    let siteKeyDev: string
    let siteKeyOwner: string
    let siteKeyEditor: string
    const createdUsers: string[] = []
    const clientIds: string[] = []

    async function makeUser(
      label: string,
      flags: { admin?: boolean; mfa?: boolean } = {},
    ) {
      const id = crypto.randomUUID()
      await db.insert(user).values({
        id,
        name: `${label} agency`,
        email: `${label}-${id}@agency.test`,
        emailVerified: true,
        isAgencyAdmin: Boolean(flags.admin),
        twoFactorEnabled: Boolean(flags.mfa),
      })
      createdUsers.push(id)
      return id
    }

    beforeAll(async () => {
      clientX = await createTestSite()
      clientY = await createTestSite()
      await createTestCollection(clientX.site.id, {
        key: 'posts',
        routePattern: '/blog/$slug',
      })
      await createTestCollection(clientY.site.id, {
        key: 'posts',
        routePattern: '/blog/$slug',
      })
      ownerX = clientX.actor.id
      await db.insert(membership).values({
        userId: ownerX,
        organizationId: clientX.org.id,
        role: 'owner',
      })
      editor = await makeUser('editor')
      await db.insert(membership).values({
        userId: editor,
        organizationId: clientX.org.id,
        role: 'editor',
      })

      admin = await makeUser('admin', { admin: true, mfa: true })
      adminNoMfa = await makeUser('admin-no-mfa', { admin: true, mfa: false })
      lapsed = await makeUser('lapsed', { admin: true, mfa: true })
      demoted = await makeUser('demoted', { admin: true, mfa: true })

      const fork = await forkDevEnvironment({ id: admin }, clientX.site.id)
      devId = fork.id
      devSlug = fork.slug

      agencyToken = (
        await createAgencyMcpKey({
          userId: admin,
          name: 'Agency test key',
          expiresInDays: 90,
        })
      ).token

      const siteKey = (
        siteId: string,
        orgId: string,
        userId: string,
        name: string,
        allowGoLive: boolean,
      ) =>
        createMcpKey({
          userId,
          siteId,
          organizationId: orgId,
          name,
          expiresInDays: 90,
          allowGoLive,
          role:
            userId === admin
              ? 'agency'
              : userId === ownerX
                ? 'owner'
                : 'editor',
        }).then((created) => created.token)
      siteKeyAdmin = await siteKey(
        clientX.site.id,
        clientX.org.id,
        admin,
        'admin site',
        true,
      )
      siteKeyAdminNoFlag = await siteKey(
        clientX.site.id,
        clientX.org.id,
        admin,
        'admin no flag',
        false,
      )
      siteKeyDev = await siteKey(
        devId,
        clientX.org.id,
        admin,
        'admin dev',
        true,
      )
      siteKeyOwner = await siteKey(
        clientX.site.id,
        clientX.org.id,
        ownerX,
        'owner',
        false,
      )
      siteKeyEditor = await siteKey(
        clientX.site.id,
        clientX.org.id,
        editor,
        'editor',
        false,
      )
    }, 120_000)

    afterAll(async () => {
      if (!runnable) return
      // Deleting the production site deletes its development environment too.
      await deleteSite(clientX.site.id, admin)
      await db.delete(site).where(eq(site.id, clientY.site.id))
      await cleanupTestSite(clientX)
      await cleanupTestSite(clientY)
      if (clientIds.length > 0) {
        await db
          .delete(oauthClient)
          .where(inArray(oauthClient.clientId, clientIds))
      }
      await db.delete(user).where(inArray(user.id, createdUsers))
    }, 120_000)

    describe('credentials', () => {
      it('refuses agency keys for users who are not agency admins, or lack MFA', async () => {
        await expect(
          createAgencyMcpKey({
            userId: ownerX,
            name: 'nope',
            expiresInDays: 30,
          }),
        ).rejects.toThrow('Only agency admins can create agency AI keys.')
        await expect(
          createAgencyMcpKey({
            userId: editor,
            name: 'nope',
            expiresInDays: 30,
          }),
        ).rejects.toThrow('Only agency admins can create agency AI keys.')
        await expect(
          createAgencyMcpKey({
            userId: adminNoMfa,
            name: 'nope',
            expiresInDays: 30,
          }),
        ).rejects.toThrow('two-factor authentication')
      })

      it('stores an agency key with scope agency, no site and no go-live flag', async () => {
        const [row] = await db
          .select()
          .from(mcpKey)
          .where(eq(mcpKey.tokenPrefix, agencyToken.slice(0, 14)))
          .limit(1)
        expect(row).toMatchObject({
          scope: 'agency',
          siteId: null,
          allowGoLive: false,
          userId: admin,
        })
        expect(agencyToken.startsWith('areca_mcp_')).toBe(true)
      })

      it('lists and revokes the caller’s own agency keys', async () => {
        const extra = await createAgencyMcpKey({
          userId: admin,
          name: 'Short-lived',
          expiresInDays: 30,
        })
        const listed = await listAgencyMcpKeys({ userId: admin })
        expect(listed.map((key) => key.id)).toContain(extra.key.id)
        expect(listed.every((key) => key.userName !== null)).toBe(true)
        await revokeAgencyMcpKey({ id: extra.key.id, userId: admin })
        const after = await resolveAgencyPrincipal(extra.token)
        expect(after).toEqual({ ok: false, reason: 'invalid' })
      })
    })

    describe('who may connect (agency address)', () => {
      it('answers a non-admin with the same 404 as an unknown site', async () => {
        const unknown = await visible(
          await handleSiteMcpRequest(
            pingRequest(siteUrl('no-such-site-here')),
            'no-such-site-here',
          ),
        )
        expect(unknown.status).toBe(404)
        for (const token of [siteKeyEditor, siteKeyOwner]) {
          const response = await visible(
            await handleAgencyMcpRequest(pingRequest(AGENCY_URL, token)),
          )
          expect(response).toEqual(unknown)
        }
      })

      it('answers an agency key whose owner lost the role without revocation with the same 404', async () => {
        const token = (
          await createAgencyMcpKey({
            userId: lapsed,
            name: 'Lapsed key',
            expiresInDays: 30,
          })
        ).token
        await db
          .update(user)
          .set({ isAgencyAdmin: false })
          .where(eq(user.id, lapsed))
        const unknown = await visible(
          await handleSiteMcpRequest(
            pingRequest(siteUrl('no-such-site-here')),
            'no-such-site-here',
          ),
        )
        expect(
          await visible(
            await handleAgencyMcpRequest(pingRequest(AGENCY_URL, token)),
          ),
        ).toEqual(unknown)
      })

      it('refuses a site key on the agency address (for an agency admin)', async () => {
        const response = await handleAgencyMcpRequest(
          pingRequest(AGENCY_URL, siteKeyAdmin),
        )
        expect(response.status).toBe(401)
        expect(await response.json()).toMatchObject({
          error: expect.stringContaining('This key is for one site'),
        })
      })

      it('refuses an agency key on a site address', async () => {
        for (const slug of [clientX.site.slug, devSlug]) {
          const response = await handleSiteMcpRequest(
            pingRequest(siteUrl(slug), agencyToken),
            slug,
          )
          expect(response.status).toBe(401)
        }
      })

      it('asks for a credential when none is sent, and refuses an unknown one', async () => {
        expect(
          (await handleAgencyMcpRequest(pingRequest(AGENCY_URL))).status,
        ).toBe(401)
        expect(
          (
            await handleAgencyMcpRequest(
              pingRequest(AGENCY_URL, 'areca_mcp_nope'),
            )
          ).status,
        ).toBe(401)
      })

      it('answers mfa_required (403) when the agency admin has lost two-factor auth', async () => {
        await db
          .update(user)
          .set({ twoFactorEnabled: false })
          .where(eq(user.id, admin))
        try {
          const response = await handleAgencyMcpRequest(
            pingRequest(AGENCY_URL, agencyToken),
          )
          expect(response.status).toBe(403)
          expect(await response.json()).toMatchObject({ code: 'mfa_required' })
        } finally {
          await db
            .update(user)
            .set({ twoFactorEnabled: true })
            .where(eq(user.id, admin))
        }
      })
    })

    describe('tools', () => {
      it('lists every per-site tool with a site argument, plus navigation', async () => {
        const agency = await connectAgency(agencyToken)
        const agencyTools = (await agency.listTools()).tools
        const agencyNames = agencyTools.map((tool) => tool.name)
        for (const nav of navigationNames) expect(agencyNames).toContain(nav)

        const siteTools = (
          await (await connectSite(siteKeyAdmin, clientX.site.slug)).listTools()
        ).tools
        const sharedNames = siteTools.map((tool) => tool.name)
        expect(
          agencyNames.filter((name) => !navigationNames.includes(name)).sort(),
        ).toEqual(
          // Environment-only tools are listed on the agency connector and refused per call.
          SITE_TOOLS.map((tool) => tool.name).sort(),
        )
        expect(sharedNames.every((name) => agencyNames.includes(name))).toBe(
          true,
        )

        for (const tool of siteTools) {
          const shared = agencyTools.find(
            (candidate) => candidate.name === tool.name,
          )!
          const own = tool.inputSchema as {
            properties?: Record<string, unknown>
            required?: string[]
          }
          const wrapped = shared.inputSchema as {
            properties?: Record<string, unknown>
            required?: string[]
          }
          const { site: siteArgument, ...rest } = wrapped.properties ?? {}
          expect(siteArgument, tool.name).toBeDefined()
          expect(rest, tool.name).toEqual(own.properties ?? {})
          expect([...(wrapped.required ?? [])].sort(), tool.name).toEqual(
            [...(own.required ?? []), 'site'].sort(),
          )
        }
        await agency.close()
      })

      it('writes to two sites of two clients in one session, and echoes each site', async () => {
        const agency = await connectAgency(agencyToken)
        const onX = await call(agency, 'create_entry', {
          site: clientX.site.slug,
          collection: 'posts',
          fields: { title: 'Agency X', slug: 'agency-x', body: 'Text on X' },
        })
        const onY = await call(agency, 'create_entry', {
          site: clientY.site.slug,
          collection: 'posts',
          fields: { title: 'Agency Y', slug: 'agency-y', body: 'Text on Y' },
        })
        expect(onX.isError, onX.text).toBe(false)
        expect(onY.isError, onY.text).toBe(false)
        expect(onX.data?.site).toMatchObject({
          slug: clientX.site.slug,
          client: clientX.org.name,
          environment: 'production',
        })
        expect(onY.data?.site).toMatchObject({
          slug: clientY.site.slug,
          client: clientY.org.name,
        })

        const rows = await db
          .select({ id: entry.id, siteId: entry.siteId })
          .from(entry)
          .where(
            inArray(entry.id, [String(onX.data?.id), String(onY.data?.id)]),
          )
        const siteOf = Object.fromEntries(
          rows.map((row) => [row.id, row.siteId]),
        )
        expect(siteOf[String(onX.data?.id)]).toBe(clientX.site.id)
        expect(siteOf[String(onY.data?.id)]).toBe(clientY.site.id)
        await agency.close()
      })

      it('reaches a development environment, and names it as one', async () => {
        const agency = await connectAgency(agencyToken)
        const info = await call(agency, 'get_site_info', { site: devSlug })
        expect(info.isError, info.text).toBe(false)
        expect(info.data?.site).toMatchObject({
          environment: 'development',
          productionSlug: clientX.site.slug,
        })
        const created = await call(agency, 'create_entry', {
          site: devSlug,
          collection: 'posts',
          fields: { title: 'Dev draft', slug: 'dev-draft', body: 'On dev' },
        })
        expect(created.isError, created.text).toBe(false)
        expect(created.data?.site).toMatchObject({
          slug: devSlug,
          environment: 'development',
        })
        await agency.close()
      })

      it('refuses production-only tools on a development environment, and development-only tools on production', async () => {
        const agency = await connectAgency(agencyToken)
        const goLive = await call(agency, 'go_live', { site: devSlug })
        expect(goLive.isError).toBe(true)
        expect(goLive.text).toBe(
          "go_live isn't available on development environments. Push to production first.",
        )
        const push = await call(agency, 'push_to_production', {
          site: clientX.site.slug,
        })
        expect(push.isError).toBe(true)
        expect(push.text).toBe(
          "push_to_production only works on a development environment. Use the site's dev environment slug (see list_sites).",
        )
        await agency.close()
      })

      it('does not need the go-live flag on the agency connector, but a per-site key without it is still refused', async () => {
        const agency = await connectAgency(agencyToken)
        const goLive = await call(agency, 'go_live', {
          site: clientX.site.slug,
        })
        // The access check passes; the test site has no deployment target, so the call stops there.
        expect(goLive.text).toContain('requires a deployment target')
        expect(goLive.text).not.toContain('Going live is not enabled')
        await agency.close()

        const perSite = await connectSite(siteKeyAdminNoFlag, clientX.site.slug)
        const names = (await perSite.listTools()).tools.map((tool) => tool.name)
        expect(names).not.toContain('go_live')
        await perSite.close()
      })

      it('finds sites by name, and lists them by client', async () => {
        const agency = await connectAgency(agencyToken)
        const clients = await call(agency, 'list_clients')
        const slugs = (clients.data?.clients as { slug: string }[]).map(
          (client) => client.slug,
        )
        expect(slugs).toEqual(
          expect.arrayContaining([clientX.org.slug, clientY.org.slug]),
        )

        const found = await call(agency, 'find_site', {
          query: clientY.org.name,
        })
        const foundSites = found.data?.sites as {
          slug: string
          environment: string
          linked: unknown
        }[]
        expect(foundSites.map((row) => row.slug)).toEqual([clientY.site.slug])
        expect(foundSites[0]).toMatchObject({
          environment: 'production',
          linked: null,
          publishingMode: expect.any(String),
          live: false,
          pendingReadyChanges: expect.any(Number),
        })

        const listed = await call(agency, 'list_sites', {
          client: clientX.org.slug,
        })
        const rows = listed.data?.sites as {
          slug: string
          linked: { slug: string } | null
        }[]
        expect(rows.map((row) => row.slug).sort()).toEqual(
          [clientX.site.slug, devSlug].sort(),
        )
        expect(
          rows.find((row) => row.slug === clientX.site.slug)?.linked,
        ).toEqual({
          environment: 'development',
          slug: devSlug,
        })
        await agency.close()
      })

      it('answers an unknown site slug with a refusal that says how to find one', async () => {
        const agency = await connectAgency(agencyToken)
        const result = await call(agency, 'get_site_info', {
          site: 'no-such-site',
        })
        expect(result.isError).toBe(true)
        expect(result.text).toContain('list_sites or find_site')
        await agency.close()
      })
    })

    describe('per-site connector stays as it was', () => {
      it('lists the same production tools for a per-site agency key as the agency connector', async () => {
        const perSite = await connectSite(siteKeyAdmin, clientX.site.slug)
        const names = (await perSite.listTools()).tools.map((tool) => tool.name)
        expect(names).toContain('go_live')
        expect(names).not.toContain('list_sites')
        expect(names).not.toContain('push_to_production')
        await perSite.close()
      })

      it('lists the development-only tools for a per-site key on a development environment', async () => {
        const perSite = await connectSite(siteKeyDev, devSlug)
        const names = (await perSite.listTools()).tools.map((tool) => tool.name)
        expect(names).toContain('push_to_production')
        expect(names).not.toContain('go_live')
        await perSite.close()
      })

      it('records the credential type in audit for a per-site call', async () => {
        const perSite = await connectSite(siteKeyAdmin, clientX.site.slug)
        const created = await call(perSite, 'create_entry', {
          collection: 'posts',
          fields: { title: 'Per site', slug: 'per-site-one', body: 'Text' },
        })
        expect(created.isError, created.text).toBe(false)
        const [row] = await db
          .select()
          .from(auditLog)
          .where(
            and(
              eq(auditLog.targetId, String(created.data?.id)),
              eq(auditLog.action, 'entry.create'),
            ),
          )
        expect(row?.meta).toMatchObject({
          via: 'mcp',
          mcpKeyName: 'admin site',
          mcpCredential: 'key',
        })
        await perSite.close()
      })
    })

    describe('audit', () => {
      it('labels agency calls via mcp-agency with the key and the credential type', async () => {
        const agency = await connectAgency(agencyToken)
        const created = await call(agency, 'create_entry', {
          site: clientX.site.slug,
          collection: 'posts',
          fields: {
            title: 'Audited agency',
            slug: 'audited-agency',
            body: 'Text',
          },
        })
        expect(created.isError, created.text).toBe(false)
        const [row] = await db
          .select()
          .from(auditLog)
          .where(
            and(
              eq(auditLog.targetId, String(created.data?.id)),
              eq(auditLog.action, 'entry.create'),
            ),
          )
        expect(row?.meta).toMatchObject({
          via: 'mcp-agency',
          mcpKeyName: 'Agency test key',
          mcpCredential: 'key',
        })
        await agency.close()
      })
    })

    describe('revocation', () => {
      it('revokes the agency keys and connections of an admin who loses the role, at once', async () => {
        const token = (
          await createAgencyMcpKey({
            userId: demoted,
            name: 'Soon revoked',
            expiresInDays: 30,
          })
        ).token
        const before = await handleAgencyMcpRequest(
          pingRequest(AGENCY_URL, token),
        )
        expect(before.status).toBe(200)

        // Another admin demotes this one: the roster's admin, so the invariant holds.
        await setAgencyAdmin(demoted, false, admin)

        const [keyRow] = await db
          .select()
          .from(mcpKey)
          .where(
            and(eq(mcpKey.userId, demoted), eq(mcpKey.name, 'Soon revoked')),
          )
        expect(keyRow?.revokedAt).not.toBeNull()
        const after = await handleAgencyMcpRequest(
          pingRequest(AGENCY_URL, token),
        )
        expect(after.status).toBe(401)
      })
    })

    describe('schema constraints (migration 0038)', () => {
      it('rejects an agency key that names a site, and a site key that names none', async () => {
        expect(
          await databaseError(
            db.insert(mcpKey).values({
              userId: admin,
              scope: 'agency',
              siteId: clientX.site.id,
              name: 'bad agency',
              tokenPrefix: 'areca_mcp_bad1',
              tokenHash: `bad-${crypto.randomUUID()}`,
            }),
          ),
        ).toContain('mcp_key_scope_check')
        expect(
          await databaseError(
            db.insert(mcpKey).values({
              userId: admin,
              scope: 'site',
              siteId: null,
              name: 'bad site',
              tokenPrefix: 'areca_mcp_bad2',
              tokenHash: `bad-${crypto.randomUUID()}`,
            }),
          ),
        ).toContain('mcp_key_scope_check')
      })

      it('allows one active agency connection per user and app', async () => {
        const clientId = `agency-test-${crypto.randomUUID()}`
        clientIds.push(clientId)
        await db.insert(oauthClient).values({
          id: crypto.randomUUID(),
          clientId,
          redirectUris: ['http://localhost/callback'],
        })
        const values = {
          userId: admin,
          scope: 'agency' as const,
          siteId: null,
          clientId,
          clientName: 'Test app',
        }
        await db.insert(mcpConnection).values(values)
        expect(
          await databaseError(db.insert(mcpConnection).values(values)),
        ).toContain('mcp_connection_agency_active_unique')
        expect(
          await databaseError(
            db.insert(mcpConnection).values({ ...values, scope: 'site' }),
          ),
        ).toContain('mcp_connection_scope_check')
      })
    })
  },
)
