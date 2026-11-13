import { eq, inArray } from 'drizzle-orm'
import {
  Client,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { db } from '#/db'
import { entry, membership, site, user } from '#/db/schema'
import { createEntry, publishEntry } from '#/server/content/entries'
import {
  cleanupTestSite,
  createTestCollection,
  createTestSite,
  sampleRichText,
} from '#/server/content/test-utils'
import { forkDevEnvironment } from '#/server/dev-env/fork'

import { createMcpKey } from './keys'
import { handleMcpRequest } from './http'
import { serverInstructions } from './server'

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
  const client = new Client({ name: 'areca-dev-test', version: '1.0.0' })
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

/** Calls a tool that may not be listed; an unknown tool counts as refused. */
async function refused(client: Client, name: string, args = {}) {
  try {
    const outcome = await call(client, name, args)
    return outcome.isError
  } catch {
    return true
  }
}

async function toolNames(client: Client): Promise<string[]> {
  const { tools } = await client.listTools()
  return tools.map((tool) => tool.name).sort()
}

/** The site block of get_site_info, read loosely for the assertions. */
function siteBlock(outcome: Outcome): Record<string, unknown> {
  const block = outcome.data?.site
  if (!block || typeof block !== 'object') throw new Error('no site block')
  return block as Record<string, unknown>
}

async function entriesWithSlug(siteId: string, slug: string) {
  return db
    .select()
    .from(entry)
    .where(eq(entry.siteId, siteId))
    .then((rows) =>
      rows.filter((row) => row.slug === slug || row.publishedSlug === slug),
    )
}

/** A complete article: the default collection requires title, slug and body. */
function article(title: string, slug: string) {
  return { title, slug, body: sampleRichText }
}

const DEV_CONNECTOR_TOOLS = [
  'push_to_production',
  'refresh_from_production',
  'copy_entry_to_production',
  'mark_ready',
  'get_site_info',
]

const DEV_HIDDEN_TOOLS = [
  'go_live',
  'rollback',
  'list_publications',
  'cancel_build',
  'get_release_status',
  'get_build_job',
  'schedule_entry',
  'cancel_schedule',
  'create_dev_environment',
]

describe.skipIf(!hasDb)('development environment tools over MCP', () => {
  let prod: Awaited<ReturnType<typeof createTestSite>>
  let other: Awaited<ReturnType<typeof createTestSite>>
  let agencyId: string
  let ownerId: string
  let editorId: string
  let devId: string
  let devSlug: string
  let readyProdEntryId: string

  let prodAgency: Client
  let devAgency: Client
  let devNoGoLive: Client
  let prodOwner: Client
  let prodEditor: Client

  let planHash: string

  beforeAll(async () => {
    prod = await createTestSite()
    await createTestCollection(prod.site.id, {
      key: 'articles',
      routePattern: '/blog/$slug',
    })
    ownerId = prod.actor.id
    await db
      .insert(membership)
      .values({ userId: ownerId, organizationId: prod.org.id, role: 'owner' })

    editorId = crypto.randomUUID()
    await db.insert(user).values({
      id: editorId,
      name: 'editor',
      email: `editor-${editorId}@test.local`,
      emailVerified: true,
    })
    await db
      .insert(membership)
      .values({ userId: editorId, organizationId: prod.org.id, role: 'editor' })

    agencyId = crypto.randomUUID()
    await db.insert(user).values({
      id: agencyId,
      name: 'agency',
      email: `agency-${agencyId}@test.local`,
      emailVerified: true,
      isAgencyAdmin: true,
      twoFactorEnabled: true,
    })

    const ready = await createEntry({
      siteId: prod.site.id,
      collectionKey: 'articles',
      data: article('Ready v1', 'ready'),
      actorId: ownerId,
    })
    await publishEntry(ready.id, ownerId)
    readyProdEntryId = ready.id

    const fork = await forkDevEnvironment({ id: agencyId }, prod.site.id)
    devId = fork.id
    devSlug = fork.slug

    const keyFor = async (
      siteId: string,
      userId: string,
      role: 'editor' | 'owner' | 'agency',
      allowGoLive: boolean,
    ) => {
      const created = await createMcpKey({
        userId,
        siteId,
        organizationId: prod.org.id,
        name: `${role} ${siteId.slice(0, 4)}`,
        expiresInDays: 90,
        allowGoLive,
        role,
      })
      return connect(created.token)
    }
    prodAgency = await keyFor(prod.site.id, agencyId, 'agency', true)
    devAgency = await keyFor(devId, agencyId, 'agency', true)
    devNoGoLive = await keyFor(devId, agencyId, 'agency', false)
    prodOwner = await keyFor(prod.site.id, ownerId, 'owner', false)
    prodEditor = await keyFor(prod.site.id, editorId, 'editor', false)

    other = await createTestSite()
  })

  afterAll(async () => {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- unset when beforeAll failed
    if (prod) {
      await db.delete(site).where(eq(site.id, prod.site.id))
      await cleanupTestSite(prod)
    }
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- unset when beforeAll failed
    if (other) await cleanupTestSite(other)
    await db
      .delete(user)
      .where(inArray(user.id, [agencyId, editorId].filter(Boolean)))
  })

  it('lists the development tools only to agency admins, on the right connector', async () => {
    const agencyProd = await toolNames(prodAgency)
    expect(agencyProd).toContain('create_dev_environment')
    expect(agencyProd).toContain('go_live')
    expect(agencyProd).not.toContain('push_to_production')
    expect(agencyProd).not.toContain('refresh_from_production')
    expect(agencyProd).not.toContain('copy_entry_to_production')

    const agencyDev = await toolNames(devAgency)
    for (const name of DEV_CONNECTOR_TOOLS) {
      expect(agencyDev).toContain(name)
    }
    for (const name of DEV_HIDDEN_TOOLS) {
      expect(agencyDev).not.toContain(name)
    }
    expect(agencyDev).toContain('set_publishing_mode')

    const owner = await toolNames(prodOwner)
    const editor = await toolNames(prodEditor)
    for (const names of [owner, editor]) {
      expect(names).not.toContain('create_dev_environment')
      expect(names).not.toContain('push_to_production')
    }
  })

  it('does not serve a development connector to a client key, even by direct request', async () => {
    const created = await createMcpKey({
      userId: ownerId,
      siteId: devId,
      organizationId: prod.org.id,
      name: 'owner on dev',
      expiresInDays: 90,
      allowGoLive: false,
      role: 'owner',
    })
    const response = await handleMcpRequest(
      new Request(MCP_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${created.token}`,
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/list',
        }),
      }),
    )
    expect(response.status).toBe(404)
  })

  it('reports the environment and the paired site in get_site_info', async () => {
    const onDev = await call(devAgency, 'get_site_info')
    const devSite = siteBlock(onDev)
    expect(devSite.environment).toBe('development')
    expect(devSite.productionSlug).toBe(prod.site.slug)
    expect(devSite).not.toHaveProperty('devEnvironment')
    expect(
      (onDev.data?.you as Record<string, unknown>).capabilities,
    ).toMatchObject({ goLive: false, schedule: false })

    const onProd = await call(prodAgency, 'get_site_info')
    const prodSite = siteBlock(onProd)
    expect(prodSite.environment).toBe('production')
    expect(prodSite).not.toHaveProperty('productionSlug')
    const pair = prodSite.devEnvironment as Record<string, unknown>
    expect(pair.slug).toBe(devSlug)
    expect(String(pair.connectorUrl)).toContain(devSlug)

    const ownerInfo = await call(prodOwner, 'get_site_info')
    expect(siteBlock(ownerInfo)).not.toHaveProperty('devEnvironment')
  })

  it('tells agency admins about the development environment in the instructions only', () => {
    const agency = {
      siteName: 'Acme',
      role: 'agency' as const,
      allowGoLive: true,
      credential: 'key' as const,
    }
    const onDev = serverInstructions(agency, {
      environment: 'development',
      productionSlug: 'acme',
      devSlug: null,
    })
    expect(onDev).toContain(
      'This is a development environment for the production site "acme".',
    )
    expect(onDev).toContain('push_to_production')
    expect(onDev).not.toContain('go_live puts the release live')

    const onProd = serverInstructions(agency, {
      environment: 'production',
      productionSlug: null,
      devSlug: 'acme-dev',
    })
    expect(onProd).toContain('This site has a development environment (')
    expect(onProd).toContain('Make changes there, then push.')

    const owner = {
      siteName: 'Acme',
      role: 'owner' as const,
      allowGoLive: true,
      credential: 'key' as const,
    }
    expect(
      serverInstructions(owner, {
        environment: 'production',
        productionSlug: null,
        devSlug: 'acme-dev',
      }),
    ).not.toContain('development environment')
  })

  it('dry run lists the changes and writes nothing', async () => {
    await createEntry({
      siteId: devId,
      collectionKey: 'articles',
      data: article('Spring menu', 'spring-menu'),
      actorId: agencyId,
    })

    const dry = await call(devAgency, 'push_to_production', {})
    expect(dry.isError).toBe(false)
    expect(dry.data?.dryRun).toBe(true)
    planHash = String(dry.data?.planHash)
    expect(planHash.length).toBeGreaterThan(0)
    const items = dry.data?.items as { kind: string; title: string }[]
    expect(items).toContainEqual(
      expect.objectContaining({ kind: 'entry.new', title: 'Spring menu' }),
    )
    expect(dry.text).toContain('Show this list to the user')
    expect(dry.data?.needsAttention).toEqual([])

    expect(await entriesWithSlug(prod.site.id, 'spring-menu')).toHaveLength(0)
  })

  it('refuses an apply without a planHash, and with a stale one', async () => {
    const missing = await call(devAgency, 'push_to_production', {
      dryRun: false,
    })
    expect(missing.isError).toBe(true)
    expect(missing.text).toContain('planHash')

    const stale = await call(devAgency, 'push_to_production', {
      dryRun: false,
      planHash: 'not-the-plan',
    })
    expect(stale.isError).toBe(true)
    expect(stale.text).toMatch(/plan changed/i)
    expect(await entriesWithSlug(prod.site.id, 'spring-menu')).toHaveLength(0)
  })

  it('refuses goLive without the go-live permission and writes nothing', async () => {
    const outcome = await call(devNoGoLive, 'push_to_production', {
      dryRun: false,
      planHash,
      goLive: true,
    })
    expect(outcome.isError).toBe(true)
    expect(outcome.text).toContain('Going live is not enabled')
    expect(await entriesWithSlug(prod.site.id, 'spring-menu')).toHaveLength(0)
  })

  it('applies a dry run with its planHash, and the production draft matches dev', async () => {
    const applied = await call(devAgency, 'push_to_production', {
      dryRun: false,
      planHash,
    })
    expect(applied.isError).toBe(false)
    expect(applied.data?.dryRun).toBe(false)
    expect(applied.data?.written).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ productionId: expect.any(String) }),
      ]),
    )

    const pushed = (await entriesWithSlug(prod.site.id, 'spring-menu')).at(0)
    expect(pushed).toBeDefined()
    expect(pushed?.status).toBe('draft')
    expect(pushed?.draftData).toMatchObject({ title: 'Spring menu' })

    const next = await call(devAgency, 'push_to_production', {})
    expect(
      (next.data?.items as { title: string }[]).map((item) => item.title),
    ).not.toContain('Spring menu')
  })

  it('marks several entries ready with a result per id, and one by id still works', async () => {
    const a = await createEntry({
      siteId: devId,
      collectionKey: 'articles',
      data: article('Ready A', 'ready-a'),
      actorId: agencyId,
    })
    const b = await createEntry({
      siteId: devId,
      collectionKey: 'articles',
      data: article('Ready B', 'ready-b'),
      actorId: agencyId,
    })

    const many = await call(devAgency, 'mark_ready', {
      ids: [a.id, b.id, 'no-such-entry'],
    })
    expect(many.isError).toBe(false)
    const results = many.data?.results as {
      id: string
      ok: boolean
      error?: string
    }[]
    expect(results).toHaveLength(3)
    expect(results.find((row) => row.id === a.id)?.ok).toBe(true)
    expect(results.find((row) => row.id === b.id)?.ok).toBe(true)
    const missing = results.find((row) => row.id === 'no-such-entry')
    expect(missing?.ok).toBe(false)
    expect(missing?.error).toContain('No entry with id')

    const rowA = (await db.select().from(entry).where(eq(entry.id, a.id))).at(0)
    expect(rowA?.publishedData).not.toBeNull()

    const single = await createEntry({
      siteId: devId,
      collectionKey: 'articles',
      data: article('Ready single', 'ready-single'),
      actorId: agencyId,
    })
    const one = await call(devAgency, 'mark_ready', { id: single.id })
    expect(one.isError).toBe(false)
    expect(one.text).toContain('Approved.')

    const neither = await call(devAgency, 'mark_ready', {})
    expect(neither.isError).toBe(true)
    const both = await call(devAgency, 'mark_ready', {
      ids: [a.id],
      expectedVersion: 1,
    })
    expect(both.isError).toBe(true)
    expect(both.text).toContain('expectedVersion')
  })

  it('copies one development entry to production as a draft', async () => {
    const dev = await createEntry({
      siteId: devId,
      collectionKey: 'articles',
      data: article('Copy me', 'copy-me'),
      actorId: agencyId,
    })
    const copied = await call(devAgency, 'copy_entry_to_production', {
      id: dev.id,
    })
    expect(copied.isError).toBe(false)
    expect(copied.data?.created).toBe(true)
    const productionId = String(copied.data?.productionId)

    const row = (
      await db.select().from(entry).where(eq(entry.id, productionId))
    ).at(0)
    expect(row?.siteId).toBe(prod.site.id)
    expect(row?.draftData).toMatchObject({ title: 'Copy me' })
    expect(row?.publishedData).toBeNull()
  })

  it('flags a URL another production entry holds in the dry run, refuses its copy, and copies markReady as a ready draft', async () => {
    await createEntry({
      siteId: prod.site.id,
      collectionKey: 'articles',
      data: article('Prod contact', 'contact-page'),
      actorId: agencyId,
    })
    const clash = await createEntry({
      siteId: devId,
      collectionKey: 'articles',
      data: article('Dev contact', 'contact-page'),
      actorId: agencyId,
    })

    const dry = await call(devAgency, 'push_to_production', {})
    expect(dry.data?.needsAttention).toContainEqual(
      expect.objectContaining({
        id: `entry:${clash.id}`,
        attention: 'slug-taken',
        summary: expect.stringContaining('is already used by "Prod contact"'),
      }),
    )
    const refusedCopy = await call(devAgency, 'copy_entry_to_production', {
      id: clash.id,
    })
    // The same slug as an unlinked production entry: refused until overwrite.
    expect(refusedCopy.isError).toBe(true)
    expect(refusedCopy.text).toContain('not linked to this development entry')

    const ready = await createEntry({
      siteId: devId,
      collectionKey: 'articles',
      data: article('Copy ready', 'copy-ready'),
      actorId: agencyId,
    })
    const copied = await call(devAgency, 'copy_entry_to_production', {
      id: ready.id,
      markReady: true,
    })
    expect(copied.isError).toBe(false)
    expect(copied.data?.warnings).toEqual([])
    const row = (
      await db
        .select()
        .from(entry)
        .where(eq(entry.id, String(copied.data?.productionId)))
    ).at(0)
    expect(row?.status).toBe('published')
    expect(row?.publishedData).toMatchObject({ title: 'Copy ready' })
  })

  it('refuses to copy an entry that is not on this connector', async () => {
    const outcome = await call(devAgency, 'copy_entry_to_production', {
      id: readyProdEntryId,
    })
    expect(outcome.isError).toBe(true)
    expect(outcome.text).toContain('No entry with id')
  })

  it('refuses the production-only controls on a development connector', async () => {
    expect(await refused(devAgency, 'go_live', {})).toBe(true)
    expect(
      await refused(devAgency, 'create_dev_environment', { confirm: true }),
    ).toBe(true)
    expect(await refused(prodAgency, 'push_to_production', {})).toBe(true)
  })

  it('refuses a production mode switch on a development environment', async () => {
    const outcome = await call(devAgency, 'set_publishing_mode', {
      mode: 'production',
    })
    expect(outcome.isError).toBe(true)
    expect(outcome.text).toContain(
      'Development environments stay in Demo mode.',
    )
  })

  it('resets from production only with confirm, and reports the discarded changes', async () => {
    const outcome = await call(devAgency, 'refresh_from_production', {
      confirm: true,
    })
    expect(outcome.isError).toBe(false)
    expect(typeof outcome.data?.discardedChanges).toBe('number')
    expect(Number(outcome.data?.discardedChanges)).toBeGreaterThan(0)
    expect(outcome.data?.counts).toEqual(
      expect.objectContaining({ entries: expect.any(Number) }),
    )
    expect(outcome.data).not.toHaveProperty('discardedEntries')

    expect(await entriesWithSlug(devId, 'copy-me')).toHaveLength(0)
    expect(await entriesWithSlug(devId, 'ready')).toHaveLength(1)
  })

  it('creates the development environment from the production connector', async () => {
    const otherAgency = await createMcpKey({
      userId: agencyId,
      siteId: other.site.id,
      organizationId: other.org.id,
      name: 'agency other',
      expiresInDays: 90,
      allowGoLive: false,
      role: 'agency',
    })
    const client = await connect(otherAgency.token)
    expect(await toolNames(client)).toContain('create_dev_environment')

    const created = await call(client, 'create_dev_environment', {
      confirm: true,
    })
    expect(created.isError).toBe(false)
    expect(String(created.data?.devSlug)).toMatch(
      new RegExp(`^${other.site.slug}-dev`),
    )
    expect(String(created.data?.devConnectorUrl)).toContain(
      String(created.data?.devSlug),
    )
    expect(created.data?.counts).toBeDefined()
    // Tokens are never sent over MCP; the CMS shows them once, in the browser
    // that created the environment. A missed one is rotated in Settings › Developer.
    expect(created.data).not.toHaveProperty('token')
    expect(created.text).toContain('shown only once')
    expect(created.text).toContain(
      'rotate the site token (and the schema token for code-first sites)',
    )

    const again = await call(client, 'create_dev_environment', {
      confirm: true,
    })
    expect(again.isError).toBe(true)
    expect(again.text).toContain('already has a development environment')
  })
})
