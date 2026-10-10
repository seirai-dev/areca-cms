/* eslint-disable @typescript-eslint/no-unnecessary-condition -- row lookups after .returning()/.select() are checked defensively */
import { and, eq, inArray } from 'drizzle-orm'
import {
  Client,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { db } from '#/db'
import {
  asset,
  auditLog,
  collection,
  entry,
  membership,
  mcpKey,
  publication,
  site,
  user,
} from '#/db/schema'
import { createEntry } from '#/server/content/entries'
import {
  cleanupTestSite,
  createTestCollection,
  createTestSite,
  sampleRichText,
} from '#/server/content/test-utils'
import { uploadAssetFromUrl } from '#/server/assets/remote'
import type * as RemoteModule from '#/server/assets/remote'

import { createMcpKey, revokeMcpKey } from './keys'
import { handleMcpRequest } from './http'
import { serverInstructions } from './server'
import { cannotDoFor } from './tools/site'

// Keep the agency-admin 2FA rule identical to the production env.
vi.hoisted(() => {
  process.env.ADMIN_MFA_REQUIRED = 'true'
})

vi.mock('#/server/assets/remote', async (importOriginal) => {
  const actual = await importOriginal<typeof RemoteModule>()
  return { ...actual, uploadAssetFromUrl: vi.fn(actual.uploadAssetFromUrl) }
})

const hasDb = Boolean(process.env.DATABASE_URL)
const MCP_URL = 'https://cms.test/api/mcp'
const FUTURE = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString()

type Role = 'editor' | 'owner' | 'agency'

type World = Awaited<ReturnType<typeof buildWorld>>

async function buildWorld() {
  const ctx = await createTestSite()
  const col = await createTestCollection(ctx.site.id, {
    key: 'posts',
    routePattern: '/blog/$slug',
  })
  const addUser = async (
    label: string,
    flags: { agency?: boolean; twoFactor?: boolean } = {},
  ) => {
    const id = crypto.randomUUID()
    await db.insert(user).values({
      id,
      name: label,
      email: `${label}-${id}@test.local`,
      emailVerified: true,
      isAgencyAdmin: Boolean(flags.agency),
      twoFactorEnabled: Boolean(flags.twoFactor),
    })
    return id
  }
  const userIds: string[] = [ctx.actor.id]
  const owner = ctx.actor.id
  await db
    .insert(membership)
    .values({ userId: owner, organizationId: ctx.org.id, role: 'owner' })

  const editor = await addUser('editor')
  userIds.push(editor)
  await db
    .insert(membership)
    .values({ userId: editor, organizationId: ctx.org.id, role: 'editor' })

  const agency = await addUser('agency', { agency: true, twoFactor: true })
  userIds.push(agency)

  const keyFor = async (
    userId: string,
    role: Role,
    overrides: { allowGoLive?: boolean; name?: string } = {},
  ) => {
    const created = await createMcpKey({
      userId,
      siteId: ctx.site.id,
      organizationId: ctx.org.id,
      name: overrides.name ?? `${role} key`,
      expiresInDays: 90,
      allowGoLive: overrides.allowGoLive ?? false,
      role,
    })
    return { token: created.token, id: created.key.id }
  }

  return {
    ctx,
    col,
    owner,
    editor,
    agency,
    userIds,
    keyFor,
    cleanup: async () => {
      await db.delete(site).where(eq(site.id, ctx.site.id))
      await cleanupTestSite(ctx)
      await db.delete(user).where(inArray(user.id, userIds.slice(1)))
    },
  }
}

/** A real MCP client wired straight into the route handler (no sockets). */
async function connect(token: string) {
  const client = new Client({ name: 'areca-test-client', version: '1.0.0' })
  const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
    fetch: (input, init) => handleMcpRequest(new Request(input, init)),
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  })
  await client.connect(transport)
  return client
}

type CallOutcome = {
  isError: boolean
  text: string
  data: Record<string, unknown> | null
}

async function call(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
): Promise<CallOutcome> {
  const result = await client.callTool({ name, arguments: args })
  const first = result.content[0]
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

async function storedEntry(id: string) {
  const [row] = await db.select().from(entry).where(eq(entry.id, id)).limit(1)
  if (!row) throw new Error('entry missing')
  return row
}

describe.skipIf(!hasDb)('MCP server', () => {
  let world: World

  beforeAll(async () => {
    world = await buildWorld()
    return async () => {
      await world.cleanup()
    }
  })

  it('answers 401 without a valid key, and for revoked keys', async () => {
    const url = new URL(MCP_URL)
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
    const headers = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    }
    const none = await handleMcpRequest(
      new Request(url, { method: 'POST', headers, body }),
    )
    expect(none.status).toBe(401)
    expect(none.headers.get('www-authenticate')).toContain('areca-mcp')
    expect(await none.json()).toEqual({
      error: 'Invalid or expired Areca MCP key',
    })

    const bad = await handleMcpRequest(
      new Request(url, {
        method: 'POST',
        headers: {
          ...headers,
          authorization: 'Bearer areca_mcp_not-a-real-key',
        },
        body,
      }),
    )
    expect(bad.status).toBe(401)

    const other = await handleMcpRequest(
      new Request(url, {
        method: 'POST',
        headers: { ...headers, authorization: 'Bearer sk_other' },
        body,
      }),
    )
    expect(other.status).toBe(401)

    const { token, id } = await world.keyFor(world.editor, 'editor', {
      name: 'Doomed',
    })
    await revokeMcpKey({
      id,
      siteId: world.ctx.site.id,
      actorId: world.editor,
      organizationId: world.ctx.org.id,
      canRevokeOthers: false,
    })
    const revoked = await handleMcpRequest(
      new Request(url, {
        method: 'POST',
        headers: { ...headers, authorization: `Bearer ${token}` },
        body,
      }),
    )
    expect(revoked.status).toBe(401)
    const [row] = await db.select().from(mcpKey).where(eq(mcpKey.id, id))
    expect(row?.revokedAt).not.toBeNull()
  })

  it('advertises only the tools each role may use', async () => {
    const editorKey = await world.keyFor(world.editor, 'editor')
    const ownerKey = await world.keyFor(world.owner, 'owner', {
      name: 'Owner plain',
    })
    const goLiveKey = await world.keyFor(world.owner, 'owner', {
      name: 'Owner go-live',
      allowGoLive: true,
    })
    const agencyKey = await world.keyFor(world.agency, 'agency')

    const editor = await toolNames(await connect(editorKey.token))
    expect(editor).toContain('create_entry')
    expect(editor).toContain('upload_asset_from_url')
    expect(editor).not.toContain('mark_ready')
    expect(editor).not.toContain('go_live')
    expect(editor).not.toContain('delete_asset')
    expect(editor).not.toContain('upsert_collection')

    const owner = await toolNames(await connect(ownerKey.token))
    expect(owner).toContain('mark_ready')
    expect(owner).toContain('delete_asset')
    expect(owner).not.toContain('go_live')
    expect(owner).not.toContain('upsert_collection')

    const goLive = await toolNames(await connect(goLiveKey.token))
    expect(goLive).toEqual(
      expect.arrayContaining(['go_live', 'rollback', 'cancel_build']),
    )

    const agency = await toolNames(await connect(agencyKey.token))
    expect(agency).toEqual(
      expect.arrayContaining([
        'upsert_collection',
        'delete_collection',
        'mark_ready',
      ]),
    )
  })

  it('creates a post from Markdown and SEO, then patches only what was sent', async () => {
    const { token } = await world.keyFor(world.editor, 'editor', {
      name: 'Laptop',
    })
    const client = await connect(token)

    const created = await call(client, 'create_entry', {
      collection: 'posts',
      fields: {
        title: 'Hello world',
        slug: 'hello-world',
        body: '## Intro\n\nSome **bold** text.',
        category: 'news',
      },
      seo: {
        title: 'Hello SEO title',
        description: 'A description of the post',
        focusKeyphrase: 'hello',
      },
    })
    expect(created.isError).toBe(false)
    const id = String(created.data?.id)
    expect(created.data?.status).toBe('draft')
    expect(created.data?.live).toBe(false)
    expect(created.data?.pendingRelease).toBe(false)
    expect('publishedAt' in (created.data ?? {})).toBe(false)
    expect(created.data?.approvedAt).toBeNull()
    expect(String(created.data?.previewUrl)).toContain(
      '/__preview/posts/hello-world?token=',
    )

    const row = await storedEntry(id)
    const body = row.draftData.body as {
      type: string
      content: { type: string }[]
    }
    expect(body.type).toBe('doc')
    expect(body.content[0]?.type).toBe('heading')
    expect((row.draftData.$seo as Record<string, unknown>).title).toBe(
      'Hello SEO title',
    )

    const patched = await call(client, 'update_entry', {
      id,
      fields: { excerpt: 'Short teaser' },
      seo: { description: '' },
      expectedVersion: row.draftVersion,
    })
    expect(patched.isError).toBe(false)
    const after = await storedEntry(id)
    expect(after.draftData.title).toBe('Hello world')
    expect(after.draftData.excerpt).toBe('Short teaser')
    expect(after.draftData.body).toEqual(row.draftData.body)
    expect(after.draftData.$seo).toEqual({
      title: 'Hello SEO title',
      focusKeyphrase: 'hello',
    })

    const stale = await call(client, 'update_entry', {
      id,
      fields: { excerpt: 'Too late' },
      expectedVersion: row.draftVersion,
    })
    expect(stale.isError).toBe(true)
    expect(stale.text).toContain('get_entry')

    const read = await call(client, 'get_entry', { id })
    expect((read.data?.fields as Record<string, unknown>).body).toContain(
      '## Intro',
    )
  })

  it('returns actionable validation errors', async () => {
    const { token } = await world.keyFor(world.editor, 'editor', {
      name: 'Validator',
    })
    const client = await connect(token)
    const typo = await call(client, 'create_entry', {
      collection: 'posts',
      fields: { titel: 'Oops', slug: 'typo-post' },
    })
    expect(typo.isError).toBe(true)
    expect(typo.text).toContain('fields.titel')
    expect(typo.text).toContain('Valid fields:')

    const badSlug = await call(client, 'create_entry', {
      collection: 'posts',
      fields: { title: 'Bad', slug: 'Not A Slug' },
    })
    expect(badSlug.isError).toBe(true)
    expect(badSlug.text).toMatch(/slug/)

    const missing = await call(client, 'create_entry', {
      collection: 'nope',
      fields: {},
    })
    expect(missing.isError).toBe(true)
    expect(missing.text).toContain('Valid collections: posts')
  })

  it('refuses owner actions for editors, both as a listing and as a direct call', async () => {
    const { token } = await world.keyFor(world.editor, 'editor', {
      name: 'Editor direct',
    })
    const client = await connect(token)
    const [draft] = await db
      .insert(entry)
      .values({
        siteId: world.ctx.site.id,
        collectionId: world.col.id,
        slug: 'editor-cannot-publish',
        draftData: {
          title: 'Ready?',
          slug: 'editor-cannot-publish',
          body: sampleRichText,
        },
        createdBy: world.editor,
        updatedBy: world.editor,
      })
      .returning()
    if (!draft) throw new Error('insert failed')

    let outcome: CallOutcome | Error
    try {
      outcome = await call(client, 'mark_ready', { id: draft.id })
    } catch (error) {
      outcome = error as Error
    }
    expect(outcome instanceof Error || outcome.isError).toBe(true)
    expect((await storedEntry(draft.id)).status).toBe('draft')
  })

  it('does not advertise scheduling to a key without go-live permission', async () => {
    const { token } = await world.keyFor(world.owner, 'owner')
    const client = await connect(token)
    expect(await toolNames(client)).not.toContain('schedule_entry')
    const created = await call(client, 'create_entry', {
      collection: 'posts',
      fields: { title: 'No schedule', slug: 'no-schedule' },
    })
    await expect(
      client.callTool({
        name: 'schedule_entry',
        arguments: { id: created.data?.id, publishAt: FUTURE, timezone: 'UTC' },
      }),
    ).rejects.toThrow()
    expect((await storedEntry(created.data?.id as string)).status).toBe('draft')
  })

  it('normalizes body-only library images on reads', async () => {
    const id = crypto.randomUUID()
    const storageKey = `${world.ctx.org.id}/body-only-${id}.png`
    await db.insert(asset).values({
      id,
      organizationId: world.ctx.org.id,
      storageKey,
      originalFilename: 'body.png',
      mimeType: 'image/png',
      size: 8,
      createdBy: world.editor,
    })
    const { token } = await world.keyFor(world.editor, 'editor')
    const client = await connect(token)
    const created = await call(client, 'create_entry', {
      collection: 'posts',
      fields: {
        title: 'Body image',
        slug: 'body-image',
        body: `![Body](asset:${id} "Title")`,
      },
    })
    expect(created.isError).toBe(false)
    const read = await call(client, 'get_entry', { id: created.data?.id })
    expect((read.data?.fields as Record<string, unknown>).body).toContain(
      `asset:${id}`,
    )
  })

  it('does not report demo-only content as production live', async () => {
    const { token } = await world.keyFor(world.owner, 'owner')
    const client = await connect(token)
    const created = await call(client, 'create_entry', {
      collection: 'posts',
      fields: { title: 'Demo title', slug: 'demo-only', body: 'Body' },
    })
    const id = created.data?.id as string
    const publicationId = crypto.randomUUID()
    await db
      .update(site)
      .set({ publishingMode: 'demo' })
      .where(eq(site.id, world.ctx.site.id))
    await db
      .insert(publication)
      .values({
        id: publicationId,
        siteId: world.ctx.site.id,
        status: 'demo',
        publishingMode: 'demo',
        snapshotHash: 'test-demo',
        snapshot: {
          publicationId,
          siteKey: world.ctx.site.slug,
          createdAt: new Date().toISOString(),
          hash: 'test-demo',
          collections: {
            posts: [
              {
                id,
                slug: 'demo-only',
                publishedAt: null,
                data: { title: 'Demo title' },
              },
            ],
          },
        },
      })
    try {
      const read = await call(client, 'get_entry', {
        id,
        includePublished: true,
      })
      expect(read.data?.live).toBe(false)
      expect(read.data?.liveFields).toBeNull()
      const listed = await call(client, 'list_entries', { collection: 'posts' })
      expect(
        (listed.data?.items as { id: string; live: boolean }[]).find(
          (item) => item.id === id,
        )?.live,
      ).toBe(false)
      const status = await call(client, 'get_release_status')
      expect((status.data?.demo as Record<string, unknown>).publicationId).toBe(
        publicationId,
      )
    } finally {
      await db.delete(publication).where(eq(publication.id, publicationId))
      await db
        .update(site)
        .set({ publishingMode: 'production' })
        .where(eq(site.id, world.ctx.site.id))
    }
  })

  it('reads deployed fields after reapproval and withdrawal', async () => {
    const { token } = await world.keyFor(world.owner, 'owner')
    const client = await connect(token)
    const created = await call(client, 'create_entry', {
      collection: 'posts',
      fields: {
        title: 'Approved new title',
        slug: 'snapshot-read',
        body: 'Body',
      },
    })
    const id = created.data?.id as string
    await call(client, 'mark_ready', { id })
    const publicationId = crypto.randomUUID()
    await db.insert(publication).values({
      id: publicationId,
      siteId: world.ctx.site.id,
      status: 'live',
      snapshotHash: 'test-live',
      snapshot: {
        publicationId,
        siteKey: world.ctx.site.slug,
        createdAt: new Date().toISOString(),
        hash: 'test-live',
        collections: {
          posts: [
            {
              id,
              slug: 'previous-live-slug',
              publishedAt: null,
              data: {
                title: 'Deployed old title',
                removedField: 'Frozen schema',
              },
            },
          ],
        },
      },
    })
    try {
      const approved = await call(client, 'get_entry', {
        id,
        includePublished: true,
      })
      expect(approved.data?.liveFields).toEqual({
        title: 'Deployed old title',
        removedField: 'Frozen schema',
      })
      expect(
        (approved.data?.approvedFields as Record<string, unknown>).title,
      ).toBe('Approved new title')
      await call(client, 'unpublish_entry', { id })
      const withdrawn = await call(client, 'get_entry', {
        id,
        includePublished: true,
      })
      expect(withdrawn.data?.liveFields).toEqual({
        title: 'Deployed old title',
        removedField: 'Frozen schema',
      })
      expect(withdrawn.data?.approvedFields).toEqual({})
    } finally {
      await db.delete(publication).where(eq(publication.id, publicationId))
    }
  })

  it('audits AI asset edits and deletions with the user and credential', async () => {
    const id = crypto.randomUUID()
    await db.insert(asset).values({
      id,
      organizationId: world.ctx.org.id,
      storageKey: `${world.ctx.org.id}/audit-${id}.png`,
      originalFilename: 'audit.png',
      mimeType: 'image/png',
      size: 8,
      createdBy: world.owner,
    })
    const { token } = await world.keyFor(world.owner, 'owner', {
      name: 'Asset audit',
    })
    const client = await connect(token)
    expect(
      (await call(client, 'update_asset_alt', { id, altText: 'New alt' }))
        .isError,
    ).toBe(false)
    expect((await call(client, 'delete_asset', { id })).isError).toBe(false)
    const events = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.targetId, id))
    expect(events.map((event) => event.action).sort()).toEqual([
      'asset.delete',
      'asset.update',
    ])
    for (const event of events) {
      expect(event.actorId).toBe(world.owner)
      expect(event.meta).toMatchObject({
        via: 'mcp',
        mcpKeyName: 'Asset audit',
      })
    }
  })

  it('lets an owner mark ready, and schedules without deploying', async () => {
    const { token } = await world.keyFor(world.owner, 'owner', {
      name: 'Owner work',
      allowGoLive: true,
    })
    const client = await connect(token)
    const { id } = (
      await call(client, 'create_entry', {
        collection: 'posts',
        fields: {
          title: 'Owner post',
          slug: 'owner-post',
          body: 'Owner body.',
        },
      })
    ).data as { id: string }

    const ready = await call(client, 'mark_ready', { id })
    expect(ready.isError).toBe(false)
    expect((await storedEntry(id)).status).toBe('published')
    expect(ready.data?.status).toBe('ready')
    expect(ready.data?.live).toBe(false)
    expect(ready.data?.pendingRelease).toBe(true)
    expect(ready.data?.message).toBe(
      'Approved. It will go live with the next release (go_live or an owner pressing Go live).',
    )
    expect(ready.text).not.toMatch(/"status": "live"/)

    const readyList = await call(client, 'list_entries', {
      collection: 'posts',
      status: 'ready',
    })
    expect(readyList.isError).toBe(false)
    const readyIds = (readyList.data?.items as { id: string }[]).map(
      (item) => item.id,
    )
    expect(readyIds).toContain(id)
    const draftList = await call(client, 'list_entries', {
      collection: 'posts',
      status: 'draft',
    })
    expect(
      (draftList.data?.items as { id: string }[]).map((item) => item.id),
    ).not.toContain(id)

    const scheduled = await call(client, 'schedule_entry', {
      id,
      publishAt: FUTURE,
      timezone: 'Europe/Amsterdam',
    })
    expect(scheduled.isError).toBe(false)
    expect((await storedEntry(id)).status).toBe('scheduled')

    const past = await call(client, 'schedule_entry', {
      id,
      publishAt: '2020-01-01T00:00:00Z',
      timezone: 'Europe/Amsterdam',
    })
    expect(past.isError).toBe(true)
  })

  it('does not reveal entries of another site', async () => {
    const other = await createTestSite()
    try {
      const otherCol = await createTestCollection(other.site.id, {
        key: 'posts',
      })
      const foreign = await createEntry({
        siteId: other.site.id,
        collectionKey: otherCol.key,
        data: { title: 'Foreign', slug: 'foreign-post', body: sampleRichText },
        actorId: other.actor.id,
      })
      const { token } = await world.keyFor(world.editor, 'editor', {
        name: 'Tenancy',
      })
      const client = await connect(token)
      const read = await call(client, 'get_entry', { id: foreign.id })
      expect(read.isError).toBe(true)
      expect(read.text).toContain('No entry with id')
      const write = await call(client, 'update_entry', {
        id: foreign.id,
        fields: { title: 'x' },
      })
      expect(write.isError).toBe(true)
      expect((await storedEntry(foreign.id)).draftData.title).toBe('Foreign')
    } finally {
      await db.delete(site).where(eq(site.id, other.site.id))
      await cleanupTestSite(other)
    }
  })

  it('labels every audited change made through a key as via AI', async () => {
    const { token } = await world.keyFor(world.editor, 'editor', {
      name: 'Audit key',
    })
    const client = await connect(token)
    const created = await call(client, 'create_entry', {
      collection: 'posts',
      fields: { title: 'Audited', slug: 'audited-post', body: 'Text' },
    })
    const id = String(created.data?.id)
    const rows = await db
      .select()
      .from(auditLog)
      .where(
        and(eq(auditLog.targetId, id), eq(auditLog.action, 'entry.create')),
      )
    expect(rows).toHaveLength(1)
    expect(rows[0]?.actorId).toBe(world.editor)
    expect(rows[0]?.meta).toMatchObject({ via: 'mcp', mcpKeyName: 'Audit key' })
  })

  it('refuses private addresses and audits imported files', async () => {
    const { token } = await world.keyFor(world.editor, 'editor', {
      name: 'Uploader',
    })
    const client = await connect(token)
    const blocked = await call(client, 'upload_asset_from_url', {
      url: 'http://127.0.0.1/cat.png',
      altText: 'A cat',
    })
    expect(blocked.isError).toBe(true)
    expect(blocked.text).toContain('private or local')

    const [row] = await db
      .insert(asset)
      .values({
        organizationId: world.ctx.org.id,
        storageKey: `${world.ctx.org.id}/mcp-test.png`,
        originalFilename: 'loaf.png',
        mimeType: 'image/png',
        size: 10,
        altText: 'A loaf',
        createdBy: world.editor,
      })
      .returning()
    if (!row) throw new Error('asset insert failed')
    vi.mocked(uploadAssetFromUrl).mockResolvedValueOnce(row)

    const uploaded = await call(client, 'upload_asset_from_url', {
      url: 'https://example.com/loaf.png',
      altText: 'A loaf',
    })
    expect(uploaded.isError).toBe(false)
    expect(uploaded.data?.assetId).toBe(row.id)

    const audits = await db
      .select()
      .from(auditLog)
      .where(
        and(eq(auditLog.targetId, row.id), eq(auditLog.action, 'asset.upload')),
      )
    expect(audits[0]?.meta).toMatchObject({ via: 'mcp' })

    const other = await client.callTool({
      name: 'get_asset',
      arguments: { id: row.id },
    })
    expect(other.isError).toBeFalsy()
  })

  it('keeps go-live off unless the key allows it', async () => {
    await db
      .update(site)
      .set({ publishingMode: 'demo' })
      .where(eq(site.id, world.ctx.site.id))
    const plain = await world.keyFor(world.owner, 'owner', {
      name: 'No go-live',
    })
    const plainClient = await connect(plain.token)
    // The tool is not advertised to this key, so a direct call is refused.
    const refused = await plainClient
      .callTool({ name: 'go_live', arguments: {} })
      .then(
        (result) => ({
          isError: Boolean(result.isError),
          text: JSON.stringify(result.content),
        }),
        (error: Error) => ({ isError: true, text: error.message }),
      )
    expect(refused.isError).toBe(true)
    expect(await toolNames(plainClient)).not.toContain('go_live')

    const allowed = await world.keyFor(world.owner, 'owner', {
      name: 'Go-live',
      allowGoLive: true,
    })
    const client = await connect(allowed.token)
    const queued = await call(client, 'go_live', { note: 'Spring update' })
    expect(queued.isError).toBe(false)
    expect(typeof queued.data?.jobId).toBe('string')

    const status = await call(client, 'get_release_status', {})
    expect(status.isError).toBe(false)
    expect(status.data?.publishingMode).toBe('demo')
  })

  it('lets an agency admin change the collection schema, scoped to its site', async () => {
    const { token } = await world.keyFor(world.agency, 'agency', {
      name: 'Schema',
    })
    const client = await connect(token)
    const upserted = await call(client, 'upsert_collection', {
      key: 'pages',
      label: 'Pages',
      routePattern: '/$slug',
      fields: [{ key: 'title', label: 'Title', type: 'text', required: true }],
    })
    expect(upserted.isError).toBe(false)
    const rows = await db
      .select()
      .from(collection)
      .where(
        and(
          eq(collection.siteId, world.ctx.site.id),
          eq(collection.key, 'pages'),
        ),
      )
    expect(rows).toHaveLength(1)
    const [event] = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.targetId, rows[0].id),
          eq(auditLog.action, 'collection.upsert'),
        ),
      )
    expect(event.actorId).toBe(world.agency)
    expect(event.meta).toMatchObject({ via: 'mcp' })

    const schema = await call(client, 'get_collection_schema', {
      collection: 'pages',
    })
    expect(schema.isError).toBe(false)
    expect(JSON.stringify(schema.data)).toContain('"example"')
  })

  it('offers a write_post prompt that walks through the workflow', async () => {
    const { token } = await world.keyFor(world.editor, 'editor', {
      name: 'Prompt',
    })
    const client = await connect(token)
    const { prompts } = await client.listPrompts()
    expect(prompts.map((prompt) => prompt.name)).toContain('write_post')
    const prompt = await client.getPrompt({
      name: 'write_post',
      arguments: { collection: 'posts', topic: 'sourdough' },
    })
    const first = prompt.messages[0]?.content
    expect(first?.type === 'text' && first.text).toContain(
      'get_collection_schema for "posts"',
    )
  })

  it('describes the caller in get_site_info', async () => {
    const { token } = await world.keyFor(world.editor, 'editor', {
      name: 'Info',
    })
    const info = await call(await connect(token), 'get_site_info', {})
    expect(info.isError).toBe(false)
    expect((info.data?.you as Record<string, unknown>).role).toBe('editor')
    expect(
      (
        (info.data?.you as Record<string, unknown>).capabilities as Record<
          string,
          unknown
        >
      ).markReady,
    ).toBe(false)
    expect(info.data?.collections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'posts', enabled: true }),
      ]),
    )
  })

  it('publishes tool input schemas that clients accept: no union-with-null types', async () => {
    const { token } = await world.keyFor(world.agency, 'agency', {
      name: 'Schema check',
    })
    const { tools } = await (await connect(token)).listTools()
    expect(tools.length).toBeGreaterThan(20)

    const offenders: string[] = []
    const walk = (node: unknown, path: string) => {
      if (Array.isArray(node)) {
        node.forEach((item, index) => walk(item, `${path}[${index}]`))
        return
      }
      if (!node || typeof node !== 'object') return
      for (const [key, value] of Object.entries(node)) {
        if (key === 'type' && (Array.isArray(value) || value === 'null'))
          offenders.push(path)
        walk(value, `${path}.${key}`)
      }
    }
    for (const tool of tools) walk(tool.inputSchema, tool.name)
    expect(offenders).toEqual([])

    const create = tools.find((tool) => tool.name === 'create_entry')
    const props = create?.inputSchema.properties as Record<
      string,
      Record<string, unknown>
    >
    expect(props.fields?.type).toBe('object')
    expect(
      props.fields?.additionalProperties === true ||
        typeof props.fields?.additionalProperties === 'object',
    ).toBe(true)
    expect(JSON.stringify(props.seo)).toContain('"jsonLd"')

    const upload = tools.find((tool) => tool.name === 'upload_asset_from_url')
    expect(upload?.description).toContain('Use a direct link to the image file')
    expect(upload?.description).toContain('do not guess other URLs')
  })

  it('tells each role how far it can go in the server instructions', async () => {
    const editor = await connect(
      (await world.keyFor(world.editor, 'editor', { name: 'Instr editor' }))
        .token,
    )
    expect(editor.getInstructions()).toContain(
      'You cannot mark entries ready or go live.',
    )
    expect(editor.getInstructions()).toContain(
      'explain that a site owner must mark it ready',
    )

    const plainOwner = await connect(
      (await world.keyFor(world.owner, 'owner', { name: 'Instr owner' })).token,
    )
    expect(plainOwner.getInstructions()).toContain(
      'Going live is not enabled for this key',
    )

    const goLiveOwner = await connect(
      (
        await world.keyFor(world.owner, 'owner', {
          name: 'Instr go-live',
          allowGoLive: true,
        })
      ).token,
    )
    expect(goLiveOwner.getInstructions()).toContain(
      'go_live puts the release live',
    )
    expect(goLiveOwner.getInstructions()).not.toContain(
      'Going live is not enabled',
    )
  })

  it('lists in get_site_info what the caller cannot do', async () => {
    const editorInfo = await call(
      await connect(
        (await world.keyFor(world.editor, 'editor', { name: 'Cannot editor' }))
          .token,
      ),
      'get_site_info',
      {},
    )
    const editorCannot = (editorInfo.data?.cannotDo as string[]).join('\n')
    expect(editorCannot).toContain(
      'Mark entries ready, schedule, unpublish, archive, delete',
    )
    expect(editorCannot).toContain('ask a site owner')
    expect(editorCannot).toContain(
      'Go live or schedule: going live is not enabled for this key',
    )
    expect(String(editorInfo.data?.guide)).toContain(
      'You cannot mark entries ready',
    )

    const ownerInfo = await call(
      await connect(
        (await world.keyFor(world.owner, 'owner', { name: 'Cannot owner' }))
          .token,
      ),
      'get_site_info',
      {},
    )
    const ownerCannot = (ownerInfo.data?.cannotDo as string[]).join('\n')
    expect(ownerCannot).toContain(
      'Go live or schedule: going live is not enabled for this key',
    )
    expect(ownerCannot).not.toContain('ask a site owner')

    const agencyInfo = await call(
      await connect(
        (await world.keyFor(world.agency, 'agency', { name: 'Cannot agency' }))
          .token,
      ),
      'get_site_info',
      {},
    )
    expect((agencyInfo.data?.cannotDo as string[]).join('\n')).not.toContain(
      'collection schemas',
    )
  })

  it('words go-live refusals for an OAuth connection without the word key', async () => {
    const oauthActor = {
      keyId: 'conn-1',
      keyName: 'ChatGPT',
      credential: 'oauth' as const,
      userId: world.owner,
      userName: 'Owner',
      siteId: world.ctx.site.id,
      siteSlug: world.ctx.site.slug,
      siteName: world.ctx.site.name,
      organizationId: world.ctx.org.id,
      role: 'owner' as const,
      allowGoLive: false,
    }
    const instructions = serverInstructions(oauthActor)
    expect(instructions).toContain(
      'Going live is not enabled for this AI connection',
    )
    expect(instructions).toContain(
      'reconnected from Connect AI with "Allow going live" ticked',
    )
    expect(instructions).not.toContain('this key')

    const cannotDo = cannotDoFor(oauthActor).join('\n')
    expect(cannotDo).toContain(
      'Go live or schedule: going live is not enabled for this AI connection',
    )
    expect(cannotDo).toContain('Allow going live')
    expect(cannotDo).not.toContain('this key')

    const goLive = { ...oauthActor, allowGoLive: true }
    expect(cannotDoFor(goLive).join('\n')).not.toContain('Go live:')
    expect(serverInstructions(goLive)).not.toContain(
      'Going live is not enabled',
    )
  })

  it('answers 403 with a clear message when an agency admin has no 2FA', async () => {
    const { token } = await world.keyFor(world.agency, 'agency', {
      name: 'Admin no 2FA',
    })
    await db
      .update(user)
      .set({ twoFactorEnabled: false })
      .where(eq(user.id, world.agency))
    try {
      const response = await handleMcpRequest(
        new Request(MCP_URL, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            accept: 'application/json, text/event-stream',
            authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
        }),
      )
      expect(response.status).toBe(403)
      expect(await response.json()).toMatchObject({
        error:
          'Your account needs two-factor authentication before AI keys work. Turn it on in Account settings.',
      })
    } finally {
      await db
        .update(user)
        .set({ twoFactorEnabled: true })
        .where(eq(user.id, world.agency))
    }
  })

  it('stores seo.jsonLd and clears seo keys with empty values on update', async () => {
    const { token } = await world.keyFor(world.editor, 'editor', {
      name: 'JSON-LD',
    })
    const client = await connect(token)
    const jsonLd = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'Thing',
      name: 'Sourdough',
    })
    const created = await call(client, 'create_entry', {
      collection: 'posts',
      fields: { title: 'Structured', slug: 'structured-post', body: 'Body.' },
      seo: {
        jsonLd,
        title: 'Structured SEO',
        keyTakeaways: ['One', 'Two'],
        noindex: true,
      },
    })
    expect(created.isError).toBe(false)
    const id = String(created.data?.id)
    expect((await storedEntry(id)).draftData.$seo).toMatchObject({
      jsonLd,
      noindex: true,
    })

    const cleared = await call(client, 'update_entry', {
      id,
      seo: { title: '', noindex: false, keyTakeaways: [] },
    })
    expect(cleared.isError).toBe(false)
    expect((await storedEntry(id)).draftData.$seo).toEqual({ jsonLd })

    const badJsonLd = await call(client, 'update_entry', {
      id,
      seo: { jsonLd: 'not json' },
    })
    expect(badJsonLd.isError).toBe(true)
    expect(badJsonLd.text).toContain('JSON')
  })

  it('keeps collection fields named like system keys under fields, and reports the release flags separately', async () => {
    await db
      .update(collection)
      .set({
        fields: [
          { key: 'title', label: 'Title', type: 'text', required: true },
          { key: 'slug', label: 'Slug', type: 'slug', required: true },
          { key: 'publishedAt', label: 'Published on', type: 'date' },
          { key: 'status', label: 'Status', type: 'text' },
        ],
      })
      .where(eq(collection.id, world.col.id))
    try {
      const { token } = await world.keyFor(world.owner, 'owner', {
        name: 'Clash',
      })
      const client = await connect(token)
      const created = await call(client, 'create_entry', {
        collection: 'posts',
        fields: {
          title: 'Clash',
          slug: 'clash-post',
          publishedAt: '2026-10-01',
          status: 'news',
        },
      })
      expect(created.isError).toBe(false)
      expect(created.data?.fields).toMatchObject({
        publishedAt: '2026-10-01',
        status: 'news',
      })
      expect(created.data?.status).toBe('draft')
      expect(created.data?.approvedAt).toBeNull()
      expect(created.data?.live).toBe(false)

      const schema = await call(client, 'get_collection_schema', {
        collection: 'posts',
      })
      expect(JSON.stringify(schema.data)).toContain(
        'Date and datetime fields are content',
      )
    } finally {
      await db
        .update(collection)
        .set({ fields: world.col.fields })
        .where(eq(collection.id, world.col.id))
    }
  })
})
