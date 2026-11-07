import { eq, inArray } from 'drizzle-orm'
import {
  Client,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { db } from '#/db'
import { membership, site, user } from '#/db/schema'
import {
  cleanupTestSite,
  createTestCollection,
  createTestGlobal,
  createTestSite,
} from '#/server/content/test-utils'

import { createMcpKey } from './keys'
import { handleMcpRequest } from './http'

vi.hoisted(() => {
  process.env.ADMIN_MFA_REQUIRED = 'true'
})

const hasDb = Boolean(process.env.DATABASE_URL)
const MCP_URL = 'https://cms.test/api/mcp'

const fields = [
  { key: 'title', label: 'Title', type: 'text' as const, required: true },
  { key: 'slug', label: 'Slug', type: 'slug' as const, required: true },
  { key: 'body', label: 'Body', type: 'richtext' as const, required: true },
]

async function connect(token: string) {
  const client = new Client({ name: 'areca-links-test', version: '1.0.0' })
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
) {
  const result = await client.callTool({ name, arguments: args })
  const first = result.content.at(0)
  const text = first?.type === 'text' ? first.text : ''
  let data: Record<string, unknown> | null = null
  if (!result.isError) {
    const parsed: unknown = JSON.parse(text)
    data =
      parsed && typeof parsed === 'object'
        ? (parsed as Record<string, unknown>)
        : null
  }
  return { isError: Boolean(result.isError), text, data }
}

describe.skipIf(!hasDb)('MCP rich text links', () => {
  let ctx: Awaited<ReturnType<typeof createTestSite>>
  let client: Client
  /** The id of the Ethiopia entry, created by the dropped-link test. */
  let ethiopiaId = ''

  beforeAll(async () => {
    ctx = await createTestSite({ languages: null })
    await createTestCollection(ctx.site.id, {
      key: 'coffees',
      routePattern: '/coffees/$slug',
      fields,
    })
    await db.insert(membership).values({
      userId: ctx.actor.id,
      organizationId: ctx.org.id,
      role: 'owner',
    })
    const created = await createMcpKey({
      userId: ctx.actor.id,
      siteId: ctx.site.id,
      organizationId: ctx.org.id,
      name: 'owner key',
      expiresInDays: 90,
      allowGoLive: false,
      role: 'owner',
    })
    client = await connect(created.token)
  })

  afterAll(async () => {
    await db.delete(site).where(eq(site.id, ctx.site.id))
    await cleanupTestSite(ctx)
    await db.delete(user).where(inArray(user.id, [ctx.actor.id]))
  })

  it('tells AI apps to use site paths and anchors in the site guide', async () => {
    const info = await call(client, 'get_site_info')
    expect(String(info.data?.guide)).toContain('/coffees/slug')
    expect(String(info.data?.guide)).toContain('#anchor')
    expect(String(info.data?.guide)).toContain(
      'Never write a full URL of this site',
    )
  })

  it('returns a warning for a dropped link and keeps its text', async () => {
    const created = await call(client, 'create_entry', {
      collection: 'coffees',
      fields: {
        title: 'Ethiopia',
        slug: 'ethiopia',
        body: 'Read [the origin notes](//evil.com) first.',
      },
    })
    expect(created.isError).toBe(false)
    expect(created.data?.warnings).toEqual([
      'Removed the link to "//evil.com": links must be https://, mailto:, a site path like /page or an anchor like #section.',
    ])
    expect(created.text).toContain('the origin notes')
    ethiopiaId = String(created.data?.id)
  })

  it('turns a site path with an anchor into an entry link, which get_entry writes as entry:<id>#anchor', async () => {
    const created = await call(client, 'create_entry', {
      collection: 'coffees',
      fields: {
        title: 'Kenya',
        slug: 'kenya',
        body: 'See [the washing station](/coffees/ethiopia#origin) for details.',
      },
    })
    expect(created.isError).toBe(false)
    expect(created.data?.warnings).toBeUndefined()
    const id = String(created.data?.id)
    const fetched = await call(client, 'get_entry', { id })
    expect(fetched.isError).toBe(false)
    expect(fetched.text).toContain(`(entry:${ethiopiaId}#origin)`)
  })
})

const DROPPED_LINK =
  'Removed the link to "//evil.com": links must be https://, mailto:, a site path like /page or an anchor like #section.'

describe.skipIf(!hasDb)('MCP rich text link warnings on updates', () => {
  let ctx: Awaited<ReturnType<typeof createTestSite>>
  let client: Client
  let entryId: string

  beforeAll(async () => {
    ctx = await createTestSite({
      languages: { main: 'nl', all: ['nl', 'en'] },
    })
    await createTestCollection(ctx.site.id, {
      key: 'coffees',
      routePattern: '/coffees/$slug',
      fields,
    })
    await createTestGlobal(ctx.site.id, {
      key: 'home',
      fields: [{ key: 'intro', label: 'Intro', type: 'richtext' }],
    })
    await db.insert(membership).values({
      userId: ctx.actor.id,
      organizationId: ctx.org.id,
      role: 'owner',
    })
    const created = await createMcpKey({
      userId: ctx.actor.id,
      siteId: ctx.site.id,
      organizationId: ctx.org.id,
      name: 'owner key',
      expiresInDays: 90,
      allowGoLive: false,
      role: 'owner',
    })
    client = await connect(created.token)
    const entry = await call(client, 'create_entry', {
      collection: 'coffees',
      fields: { title: 'Sidamo', slug: 'sidamo', body: 'Een kopje.' },
    })
    expect(entry.isError).toBe(false)
    entryId = String(entry.data?.id)
  })

  afterAll(async () => {
    await db.delete(site).where(eq(site.id, ctx.site.id))
    await cleanupTestSite(ctx)
    await db.delete(user).where(inArray(user.id, [ctx.actor.id]))
  })

  it('returns the dropped-link warning from update_entry', async () => {
    const updated = await call(client, 'update_entry', {
      id: entryId,
      fields: { body: 'Lees [de notities](//evil.com) eerst.' },
    })
    expect(updated.isError).toBe(false)
    expect(updated.data?.warnings).toEqual([DROPPED_LINK])
    expect(updated.text).toContain('de notities')
  })

  it('returns the dropped-link warning from a localized update_entry', async () => {
    const updated = await call(client, 'update_entry', {
      id: entryId,
      locale: 'en',
      fields: { body: 'Read [the notes](//evil.com) first.' },
    })
    expect(updated.isError).toBe(false)
    expect(updated.data?.warnings).toEqual([DROPPED_LINK])
    expect(updated.text).toContain('the notes')
  })

  it('returns the dropped-link warning from update_global', async () => {
    const updated = await call(client, 'update_global', {
      global: 'home',
      fields: { intro: 'Lees [de notities](//evil.com) eerst.' },
    })
    expect(updated.isError).toBe(false)
    expect(updated.data?.warnings).toEqual([DROPPED_LINK])
    expect(updated.text).toContain('de notities')
  })

  it('returns the dropped-link warning from a localized update_global', async () => {
    const updated = await call(client, 'update_global', {
      global: 'home',
      locale: 'en',
      fields: { intro: 'Read [the notes](//evil.com) first.' },
    })
    expect(updated.isError).toBe(false)
    expect(updated.data?.warnings).toEqual([DROPPED_LINK])
    expect(updated.text).toContain('the notes')
  })

  it('stays silent when the links are allowed', async () => {
    const updated = await call(client, 'update_global', {
      global: 'home',
      locale: 'en',
      fields: {
        intro:
          'See [the FAQ](/coffees/sidamo#faq) and [us](https://example.com).',
      },
    })
    expect(updated.isError).toBe(false)
    expect(updated.data?.warnings).toBeUndefined()
  })
})
