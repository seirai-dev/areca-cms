import {
  Client,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { db } from '#/db'
import { membership, site } from '#/db/schema'
import { eq } from 'drizzle-orm'
import { createEntry, getEntry } from '#/server/content/entries'
import {
  createTestCollection,
  createTestSite,
} from '#/server/content/test-utils'

import { createMcpKey } from './keys'
import { handleMcpRequest } from './http'

/**
 * update_entry names the entries whose links point at a section the update
 * removed or renamed, and does not rewrite them (docs/design/rich-text-links.md,
 * decision 22).
 */

const hasDb = Boolean(process.env.DATABASE_URL)
const MCP_URL = 'https://cms.test/api/mcp'

const fields = [
  { key: 'title', label: 'Title', type: 'text' as const, required: true },
  { key: 'slug', label: 'Slug', type: 'slug' as const, required: true },
  { key: 'body', label: 'Body', type: 'richtext' as const, required: true },
]

async function connect(token: string) {
  const client = new Client({
    name: 'areca-section-links-test',
    version: '1.0.0',
  })
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
  args: Record<string, unknown>,
) {
  const result = await client.callTool({ name, arguments: args })
  const first = result.content.at(0)
  const text = first?.type === 'text' ? first.text : ''
  const data = result.isError
    ? null
    : (JSON.parse(text) as Record<string, unknown>)
  return { isError: Boolean(result.isError), text, data }
}

/** A page with an "Origin" heading and a paragraph linking to `targetId` at `origin`. */
function linkingBody(targetId: string) {
  return {
    type: 'doc',
    content: [
      {
        type: 'heading',
        attrs: { level: 2 },
        content: [{ type: 'text', text: 'Origin' }],
      },
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: 'Read about it',
            marks: [
              {
                type: 'link',
                attrs: {
                  href: '/blog/ethiopia-mcp#origin',
                  entryId: targetId,
                  collection: 'articles',
                  anchor: 'origin',
                },
              },
            ],
          },
        ],
      },
    ],
  }
}

describe.skipIf(!hasDb)('MCP update_entry: section link warnings', () => {
  let ctx: Awaited<ReturnType<typeof createTestSite>>
  let client: Client
  let targetId = ''
  let sourceId = ''

  beforeAll(async () => {
    ctx = await createTestSite()
    await createTestCollection(ctx.site.id, {
      key: 'articles',
      routePattern: '/blog/$slug',
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
    const target = await createEntry({
      siteId: ctx.site.id,
      collectionKey: 'articles',
      data: {
        title: 'Ethiopia',
        slug: 'ethiopia-mcp',
        body: {
          type: 'doc',
          content: [
            {
              type: 'heading',
              attrs: { level: 2 },
              content: [{ type: 'text', text: 'Origin' }],
            },
            { type: 'paragraph', content: [{ type: 'text', text: 'Beans' }] },
          ],
        },
      },
      actorId: ctx.actor.id,
    })
    targetId = target.id
    const source = await createEntry({
      siteId: ctx.site.id,
      collectionKey: 'articles',
      data: {
        title: 'Bron',
        slug: 'bron-mcp',
        body: linkingBody(targetId),
      },
      actorId: ctx.actor.id,
    })
    sourceId = source.id
  })

  afterAll(async () => {
    await db.delete(site).where(eq(site.id, ctx.site.id))
  })

  it('names the entries that link to the removed section, and leaves them as they are', async () => {
    const before = await getEntry(sourceId)
    const removed = await call(client, 'update_entry', {
      id: targetId,
      fields: { body: 'Only the beans now.' },
    })
    expect(removed.isError).toBe(false)
    expect(removed.data?.warnings).toEqual([
      `1 link points to the section 'origin' that no longer exists: Bron (${sourceId}). Update them with update_entry.`,
    ])
    const after = await getEntry(sourceId)
    expect(after!.draftData).toEqual(before!.draftData)
    expect(after!.draftVersion).toBe(before!.draftVersion)
  })

  it('gives no warning for an update that keeps the section', async () => {
    const kept = await call(client, 'update_entry', {
      id: targetId,
      fields: { body: '## Origin\n\nBeans from the highlands.' },
    })
    expect(kept.isError).toBe(false)
    expect(kept.data?.warnings).toBeUndefined()
  })
})
