import { and, eq, inArray } from 'drizzle-orm'
import {
  Client,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { db } from '#/db'
import { auditLog, membership, publication, site, user } from '#/db/schema'
import {
  cleanupTestSite,
  createTestCollection,
  createTestSite,
} from '#/server/content/test-utils'

import { createMcpKey } from './keys'
import { handleMcpRequest } from './http'

vi.hoisted(() => {
  process.env.ADMIN_MFA_REQUIRED = 'true'
})

const hasDb = Boolean(process.env.DATABASE_URL)
const MCP_URL = 'https://cms.test/api/mcp'

type Outcome = {
  isError: boolean
  text: string
  data: Record<string, unknown> | null
}

async function connect(token: string) {
  const client = new Client({ name: 'areca-mode-test', version: '1.0.0' })
  const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
    fetch: (input, init) => handleMcpRequest(new Request(input, init)),
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

async function toolNames(client: Client): Promise<string[]> {
  const { tools } = await client.listTools()
  return tools.map((tool) => tool.name).sort()
}

async function modeAuditEntries(siteId: string) {
  const rows = await db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.siteId, siteId), eq(auditLog.action, 'site.update')))
  return rows.filter(
    (row) =>
      row.meta !== null &&
      typeof row.meta === 'object' &&
      'publishingMode' in row.meta,
  )
}

async function makeWorld() {
  const ctx = await createTestSite()
  await createTestCollection(ctx.site.id, {
    key: 'posts',
    routePattern: '/$slug',
    fields: [
      { key: 'title', label: 'Title', type: 'text', required: true },
      { key: 'slug', label: 'Slug', type: 'slug', required: true },
    ],
  })
  await db
    .insert(membership)
    .values({ userId: ctx.actor.id, organizationId: ctx.org.id, role: 'owner' })
  const agencyId = crypto.randomUUID()
  await db.insert(user).values({
    id: agencyId,
    name: 'agency',
    email: `agency-${agencyId}@test.local`,
    emailVerified: true,
    isAgencyAdmin: true,
    twoFactorEnabled: true,
  })
  const editorId = crypto.randomUUID()
  await db.insert(user).values({
    id: editorId,
    name: 'editor',
    email: `editor-${editorId}@test.local`,
    emailVerified: true,
  })
  await db
    .insert(membership)
    .values({ userId: editorId, organizationId: ctx.org.id, role: 'editor' })
  const keyFor = async (
    userId: string,
    role: 'owner' | 'editor' | 'agency',
  ) => {
    const created = await createMcpKey({
      userId,
      siteId: ctx.site.id,
      organizationId: ctx.org.id,
      name: `${role} key`,
      expiresInDays: 90,
      allowGoLive: false,
      role,
    })
    return created.token
  }
  return {
    ctx,
    agencyId,
    owner: await keyFor(ctx.actor.id, 'owner'),
    editor: await keyFor(editorId, 'editor'),
    agency: await keyFor(agencyId, 'agency'),
    cleanup: async () => {
      await db.delete(site).where(eq(site.id, ctx.site.id))
      await cleanupTestSite(ctx)
      await db.delete(user).where(inArray(user.id, [agencyId, editorId]))
    },
  }
}

describe.skipIf(!hasDb)('MCP set_publishing_mode and deployment info', () => {
  let world: Awaited<ReturnType<typeof makeWorld>>
  let owner: Client
  let editor: Client
  let agency: Client

  beforeAll(async () => {
    world = await makeWorld()
    owner = await connect(world.owner)
    editor = await connect(world.editor)
    agency = await connect(world.agency)
  })
  afterAll(async () => {
    await world.cleanup()
  })

  it('lists set_publishing_mode only for agency admins', async () => {
    expect(await toolNames(agency)).toContain('set_publishing_mode')
    expect(await toolNames(owner)).not.toContain('set_publishing_mode')
    expect(await toolNames(editor)).not.toContain('set_publishing_mode')
  })

  it('reports publishingMode and deploymentConfigured in get_site_info', async () => {
    const info = await call(owner, 'get_site_info')
    expect(info.data?.site).toMatchObject({
      publishingMode: 'production',
      deploymentConfigured: false,
    })
  })

  it('refuses set_publishing_mode for owners by name, as an unknown tool', async () => {
    await expect(
      call(owner, 'set_publishing_mode', { mode: 'demo' }),
    ).rejects.toThrow()
  })

  it('is a no-op when the site is already in that mode, and writes no audit entry', async () => {
    const before = (await modeAuditEntries(world.ctx.site.id)).length
    const result = await call(agency, 'set_publishing_mode', {
      mode: 'production',
    })
    expect(result.isError).toBe(false)
    expect(result.data).toEqual({
      publishingMode: 'production',
      deploymentConfigured: false,
    })
    expect((await modeAuditEntries(world.ctx.site.id)).length).toBe(before)
  })

  it('refuses production without a deployment target and names Settings › Deployment', async () => {
    await call(agency, 'set_publishing_mode', { mode: 'demo' })
    const result = await call(agency, 'set_publishing_mode', {
      mode: 'production',
    })
    expect(result.isError).toBe(true)
    expect(result.text).toContain('Settings › Deployment')
    const [row] = await db
      .select({ mode: site.publishingMode })
      .from(site)
      .where(eq(site.id, world.ctx.site.id))
    expect(row.mode).toBe('demo')
  })

  it('switches a never-live site to demo, and audits the change with the MCP caller', async () => {
    const before = (await modeAuditEntries(world.ctx.site.id)).length
    // Back to production first: the demo switch below is the one under test.
    await db
      .update(site)
      .set({ publishingMode: 'production' })
      .where(eq(site.id, world.ctx.site.id))
    const result = await call(agency, 'set_publishing_mode', { mode: 'demo' })
    expect(result.isError).toBe(false)
    expect(result.data).toEqual({
      publishingMode: 'demo',
      deploymentConfigured: false,
    })

    const entries = await modeAuditEntries(world.ctx.site.id)
    expect(entries.length).toBe(before + 1)
    const latest = entries.at(-1)
    expect(latest?.actorId).toBe(world.agencyId)
    expect(latest?.meta).toMatchObject({
      publishingMode: 'demo',
      previousPublishingMode: 'production',
      via: 'mcp',
    })
  })

  it('is a no-op when already in demo mode', async () => {
    const before = (await modeAuditEntries(world.ctx.site.id)).length
    const result = await call(agency, 'set_publishing_mode', { mode: 'demo' })
    expect(result.isError).toBe(false)
    expect(result.data).toMatchObject({ publishingMode: 'demo' })
    expect((await modeAuditEntries(world.ctx.site.id)).length).toBe(before)
  })

  it('switches to production once a deployment target is configured', async () => {
    await db
      .update(site)
      .set({
        deploymentTarget: {
          provider: 'dokploy',
          applicationId: 'app-test-1',
          healthCheckUrl: 'https://example.test/health',
        },
      })
      .where(eq(site.id, world.ctx.site.id))
    const result = await call(agency, 'set_publishing_mode', {
      mode: 'production',
    })
    expect(result.isError).toBe(false)
    expect(result.data).toEqual({
      publishingMode: 'production',
      deploymentConfigured: true,
    })
    const info = await call(owner, 'get_site_info')
    expect(info.data?.site).toMatchObject({
      publishingMode: 'production',
      deploymentConfigured: true,
    })
  })

  it('refuses demo once the site has gone live in production', async () => {
    await db.insert(publication).values({
      siteId: world.ctx.site.id,
      snapshot: { schemaVersion: 1 } as never,
      snapshotHash: `live-${crypto.randomUUID()}`,
      status: 'superseded',
      publishingMode: 'production',
      wasLive: true,
    })
    const result = await call(agency, 'set_publishing_mode', { mode: 'demo' })
    expect(result.isError).toBe(true)
    expect(result.text).toContain('Settings › Deployment')
    const [row] = await db
      .select({ mode: site.publishingMode })
      .from(site)
      .where(eq(site.id, world.ctx.site.id))
    expect(row.mode).toBe('production')
  })
})
