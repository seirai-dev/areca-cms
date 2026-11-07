import { eq, inArray } from 'drizzle-orm'
import {
  Client,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { db } from '#/db'
import { entry, membership, site, user } from '#/db/schema'
import { I18N_KEY } from '#/lib/content-locale'
import { createEntry } from '#/server/content/entries'
import {
  cleanupTestSite,
  createSiteInOrganization,
  createTestCollection,
  createTestGlobal,
  createTestSite,
} from '#/server/content/test-utils'

import { createMcpKey } from './keys'
import { handleMcpRequest } from './http'

const hasDb = Boolean(process.env.DATABASE_URL)
const MCP_URL = 'https://cms.test/api/mcp'
/** The site's own production address (createTestSite). */
const OWN_ORIGIN = 'http://localhost:3999'
/** An id no entry has. */
const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000'

const fields = [
  { key: 'title', label: 'Title', type: 'text' as const, required: true },
  { key: 'slug', label: 'Slug', type: 'slug' as const, required: true },
  { key: 'body', label: 'Body', type: 'richtext' as const, required: true },
]

const PARAGRAPH = (text: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
})

async function connect(token: string) {
  const client = new Client({
    name: 'areca-entry-links-test',
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

type Node = {
  type?: string
  text?: string
  marks?: { type: string; attrs?: Record<string, unknown> }[]
  content?: Node[]
}

/** The link marks of a stored rich text value, in document order. */
function linksOf(
  json: unknown,
): { text: string; attrs: Record<string, unknown> }[] {
  const out: { text: string; attrs: Record<string, unknown> }[] = []
  const visit = (node: Node) => {
    for (const mark of node.marks ?? []) {
      if (mark.type === 'link') {
        out.push({ text: node.text ?? '', attrs: mark.attrs ?? {} })
      }
    }
    for (const child of node.content ?? []) visit(child)
  }
  visit(json as Node)
  return out
}

/** The stored rich text of one field, in the main language or in `locale`. */
async function storedField(id: string, field: string, locale?: string) {
  const row = (
    await db
      .select({ draftData: entry.draftData })
      .from(entry)
      .where(eq(entry.id, id))
      .limit(1)
  ).at(0)
  if (!row) throw new Error(`entry ${id} is missing`)
  const data = row.draftData as Record<string, unknown>
  if (!locale) return data[field]
  const translations = data[I18N_KEY] as Record<
    string,
    Record<string, unknown> | undefined
  >
  return translations[locale]?.[field]
}

describe.skipIf(!hasDb)('MCP entry links from Markdown', () => {
  let ctx: Awaited<ReturnType<typeof createTestSite>>
  let client: Client
  let ethiopiaId: string
  let siblingEntryId: string

  beforeAll(async () => {
    ctx = await createTestSite({
      languages: { main: 'nl', all: ['nl', 'en'] },
    })
    await createTestCollection(ctx.site.id, {
      key: 'articles',
      routePattern: '/blog/$slug',
      localizedRoutes: { en: '/news/$slug' },
      fields,
    })
    await createTestGlobal(ctx.site.id, {
      key: 'home',
      fields: [{ key: 'intro', label: 'Intro', type: 'richtext' }],
    })
    // Another site of the same organization: its entries are not this site's.
    const sibling = await createSiteInOrganization(ctx.org.id)
    await createTestCollection(sibling.id, {
      key: 'articles',
      routePattern: '/blog/$slug',
      fields,
    })
    const elsewhere = await createEntry({
      siteId: sibling.id,
      collectionKey: 'articles',
      data: { title: 'Elders', slug: 'elders', body: PARAGRAPH('Elders') },
      actorId: ctx.actor.id,
    })
    siblingEntryId = elsewhere.id
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
    const ethiopia = await call(client, 'create_entry', {
      collection: 'articles',
      fields: {
        title: 'Ethiopia',
        slug: 'ethiopia',
        body: 'Een kopje uit Ethiopië.',
      },
    })
    expect(ethiopia.isError).toBe(false)
    ethiopiaId = String(ethiopia.data?.id)
    // The English view: its own slug, so the English path is /news/coffee-ethiopia.
    const english = await call(client, 'update_entry', {
      id: ethiopiaId,
      locale: 'en',
      slug: 'coffee-ethiopia',
      fields: { title: 'Coffee from Ethiopia', body: 'A cup from Ethiopia.' },
    })
    expect(english.isError).toBe(false)
  })

  afterAll(async () => {
    await db.delete(site).where(eq(site.id, ctx.site.id))
    await cleanupTestSite(ctx)
    await db.delete(user).where(inArray(user.id, [ctx.actor.id]))
  })

  it('turns entry:<id>#anchor into an entry link, and get_entry writes it back as entry:', async () => {
    const created = await call(client, 'create_entry', {
      collection: 'articles',
      fields: {
        title: 'Kenya',
        slug: 'kenya',
        body: `Read [the origin](entry:${ethiopiaId}#origin) first.`,
      },
    })
    expect(created.isError).toBe(false)
    expect(created.data?.warnings).toBeUndefined()
    const id = String(created.data?.id)
    expect(linksOf(await storedField(id, 'body'))).toEqual([
      {
        text: 'the origin',
        attrs: {
          href: '/blog/ethiopia#origin',
          entryId: ethiopiaId,
          collection: 'articles',
          anchor: 'origin',
        },
      },
    ])
    const fetched = await call(client, 'get_entry', { id })
    expect(fetched.text).toContain(`(entry:${ethiopiaId}#origin)`)
    expect(fetched.text).not.toContain('/blog/ethiopia')
  })

  it('turns a site path into an entry link', async () => {
    const created = await call(client, 'create_entry', {
      collection: 'articles',
      fields: {
        title: 'Burundi',
        slug: 'burundi',
        body: 'Zie [Ethiopië](/blog/ethiopia).',
      },
    })
    expect(created.isError).toBe(false)
    expect(created.data?.warnings).toBeUndefined()
    const links = linksOf(await storedField(String(created.data?.id), 'body'))
    expect(links).toEqual([
      {
        text: 'Ethiopië',
        attrs: {
          href: '/blog/ethiopia',
          entryId: ethiopiaId,
          collection: 'articles',
          anchor: null,
        },
      },
    ])
  })

  it('turns an own-domain URL into an entry link, with its section', async () => {
    const created = await call(client, 'create_entry', {
      collection: 'articles',
      fields: {
        title: 'Rwanda',
        slug: 'rwanda',
        body: `Lees [de herkomst](${OWN_ORIGIN}/blog/ethiopia#origin).`,
      },
    })
    expect(created.isError).toBe(false)
    expect(created.data?.warnings).toBeUndefined()
    const links = linksOf(await storedField(String(created.data?.id), 'body'))
    expect(links).toHaveLength(1)
    expect(links[0].attrs).toMatchObject({
      entryId: ethiopiaId,
      anchor: 'origin',
    })
  })

  it('keeps a path that matches no page, and a path with a query string, as plain links', async () => {
    const created = await call(client, 'create_entry', {
      collection: 'articles',
      fields: {
        title: 'Uganda',
        slug: 'uganda',
        body: 'Nog [later](/blog/not-yet) en [zoek](/blog/ethiopia?ref=home).',
      },
    })
    expect(created.isError).toBe(false)
    expect(created.data?.warnings).toBeUndefined()
    const links = linksOf(await storedField(String(created.data?.id), 'body'))
    expect(links.map((link) => link.attrs)).toEqual([
      { href: '/blog/not-yet' },
      { href: '/blog/ethiopia?ref=home' },
    ])
  })

  it('keeps the text and warns with the id for an unknown entry', async () => {
    const created = await call(client, 'create_entry', {
      collection: 'articles',
      fields: {
        title: 'Tanzania',
        slug: 'tanzania',
        body: `Zie [de oude pagina](entry:${UNKNOWN_ID}).`,
      },
    })
    expect(created.isError).toBe(false)
    expect(created.data?.warnings).toEqual([
      `Removed the link to entry "${UNKNOWN_ID}": no entry of this site has that id, or it has no page. The text is kept.`,
    ])
    expect(created.text).toContain('de oude pagina')
    expect(
      linksOf(await storedField(String(created.data?.id), 'body')),
    ).toEqual([])
  })

  it('refuses an entry of another site the same way', async () => {
    const created = await call(client, 'create_entry', {
      collection: 'articles',
      fields: {
        title: 'Malawi',
        slug: 'malawi',
        body: `Zie [elders](entry:${siblingEntryId}).`,
      },
    })
    expect(created.isError).toBe(false)
    expect(created.data?.warnings).toEqual([
      `Removed the link to entry "${siblingEntryId}": no entry of this site has that id, or it has no page. The text is kept.`,
    ])
    expect(
      linksOf(await storedField(String(created.data?.id), 'body')),
    ).toEqual([])
  })

  it('resolves a link in a non-main language through that language', async () => {
    const created = await call(client, 'create_entry', {
      collection: 'articles',
      fields: {
        title: 'Zambia',
        slug: 'zambia',
        body: 'Nederlands.',
      },
    })
    expect(created.isError).toBe(false)
    const id = String(created.data?.id)
    const english = await call(client, 'update_entry', {
      id,
      locale: 'en',
      slug: 'zambia',
      fields: {
        body: `See [the coffee](/news/coffee-ethiopia) and [the origin](entry:${ethiopiaId}#origin).`,
      },
    })
    expect(english.isError).toBe(false)
    expect(english.data?.warnings).toBeUndefined()
    const links = linksOf(await storedField(id, 'body', 'en'))
    expect(links.map((link) => link.attrs)).toEqual([
      {
        href: '/blog/ethiopia',
        entryId: ethiopiaId,
        collection: 'articles',
        anchor: null,
      },
      {
        href: '/blog/ethiopia#origin',
        entryId: ethiopiaId,
        collection: 'articles',
        anchor: 'origin',
      },
    ])
  })

  it('resolves entry links in update_global', async () => {
    const updated = await call(client, 'update_global', {
      global: 'home',
      fields: {
        intro: `Lees [de herkomst](entry:${ethiopiaId}#origin) eerst.`,
      },
    })
    expect(updated.isError).toBe(false)
    expect(updated.data?.warnings).toBeUndefined()
    const links = linksOf(await storedField(String(updated.data?.id), 'intro'))
    expect(links.map((link) => link.attrs)).toEqual([
      {
        href: '/blog/ethiopia#origin',
        entryId: ethiopiaId,
        collection: 'articles',
        anchor: 'origin',
      },
    ])
  })

  it('keeps the links through a get_entry and update_entry round trip', async () => {
    const created = await call(client, 'create_entry', {
      collection: 'articles',
      fields: {
        title: 'Namibia',
        slug: 'namibia',
        body: `Lees [de herkomst](entry:${ethiopiaId}#origin) en [Ethiopië](/blog/ethiopia).`,
      },
    })
    expect(created.isError).toBe(false)
    const id = String(created.data?.id)
    const before = linksOf(await storedField(id, 'body'))
    expect(before).toHaveLength(2)

    const fetched = await call(client, 'get_entry', { id })
    const fieldsOut = fetched.data?.fields as Record<string, unknown>
    expect(fieldsOut.body).toBe(
      `Lees [de herkomst](entry:${ethiopiaId}#origin) en [Ethiopië](entry:${ethiopiaId}).`,
    )
    const unchanged = await call(client, 'update_entry', {
      id,
      fields: { body: fieldsOut.body },
    })
    expect(unchanged.isError).toBe(false)
    expect(unchanged.data?.warnings).toBeUndefined()
    const after = linksOf(await storedField(id, 'body'))
    expect(after).toEqual(before)
  })
})
