import { and, eq, inArray } from 'drizzle-orm'
import {
  Client,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client'
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

import { db } from '#/db'
import {
  asset,
  auditLog,
  collection,
  deletedContentArchive,
  entry,
  membership,
  mcpKey,
  publication,
  site,
  user,
} from '#/db/schema'
import type { Field } from '#/lib/types'
import { createEntry } from '#/server/content/entries'
import {
  cleanupTestSite,
  createTestCollection,
  createTestSite,
  sampleRichText,
} from '#/server/content/test-utils'
import { uploadAssetFromUrl } from '#/server/assets/remote'
import { buildSnapshot } from '#/server/content/snapshot'
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

async function storedEntry(id: string) {
  const row = (
    await db.select().from(entry).where(eq(entry.id, id)).limit(1)
  ).at(0)
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
    const row = (await db.select().from(mcpKey).where(eq(mcpKey.id, id))).at(0)
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
    const draft = (
      await db
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
    ).at(0)
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
      originSiteId: world.ctx.site.id,
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
    await db.insert(publication).values({
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
      originSiteId: world.ctx.site.id,
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

  it('approves only the version the owner reviewed when expectedVersion is sent', async () => {
    const { token } = await world.keyFor(world.owner, 'owner', {
      name: 'Reviewed approval',
      allowGoLive: true,
    })
    const client = await connect(token)
    const created = await call(client, 'create_entry', {
      collection: 'posts',
      fields: { title: 'Reviewed', slug: 'reviewed-approval', body: 'First.' },
    })
    const { id, version } = created.data as { id: string; version: number }

    await call(client, 'update_entry', {
      id,
      fields: { body: 'Changed by someone else.' },
      expectedVersion: version,
    })
    const stale = await call(client, 'mark_ready', {
      id,
      expectedVersion: version,
    })
    expect(stale.isError).toBe(true)
    expect((await storedEntry(id)).status).toBe('draft')

    const scheduleStale = await call(client, 'schedule_entry', {
      id,
      publishAt: FUTURE,
      timezone: 'UTC',
      expectedVersion: version,
    })
    expect(scheduleStale.isError).toBe(true)
    expect((await storedEntry(id)).status).toBe('draft')

    const reviewed = await call(client, 'get_entry', { id })
    const ready = await call(client, 'mark_ready', {
      id,
      expectedVersion: (reviewed.data as { version: number }).version,
    })
    expect(ready.isError).toBe(false)
    expect((await storedEntry(id)).status).toBe('published')
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

    const row = (
      await db
        .insert(asset)
        .values({
          organizationId: world.ctx.org.id,
          originSiteId: world.ctx.site.id,
          storageKey: `${world.ctx.org.id}/mcp-test.png`,
          originalFilename: 'loaf.png',
          mimeType: 'image/png',
          size: 10,
          altText: 'A loaf',
          createdBy: world.editor,
        })
        .returning()
    ).at(0)
    if (!row) throw new Error('asset insert failed')
    vi.mocked(uploadAssetFromUrl).mockResolvedValueOnce(row)

    const uploaded = await call(client, 'upload_asset_from_url', {
      url: 'https://example.com/loaf.png',
      altText: 'A loaf',
    })
    expect(uploaded.isError).toBe(false)
    expect(uploaded.data?.assetId).toBe(row.id)
    expect(vi.mocked(uploadAssetFromUrl)).toHaveBeenLastCalledWith(
      expect.objectContaining({ originSiteId: world.ctx.site.id }),
    )

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

  it('reports a language change in get_release_status', async () => {
    const { token } = await world.keyFor(world.owner, 'owner', {
      name: 'Language status',
    })
    const client = await connect(token)
    // Earlier tests may leave the site in demo mode; this one compares to live.
    await db
      .update(site)
      .set({
        publishingMode: 'production',
        languages: { main: 'en', all: ['en', 'nl'] },
      })
      .where(eq(site.id, world.ctx.site.id))
    const built = await buildSnapshot(world.ctx.site.id)
    if (!built.ok) throw new Error(built.errors.join('\n'))
    const publicationId = crypto.randomUUID()
    await db.insert(publication).values({
      id: publicationId,
      siteId: world.ctx.site.id,
      snapshot: { ...built.snapshot, publicationId },
      snapshotHash: built.hash,
      status: 'live',
      wasLive: true,
    })
    try {
      const before = await call(client, 'get_release_status', {})
      expect(before.data?.languageChange).toBeNull()

      await db
        .update(site)
        .set({ languages: { main: 'en', all: ['en', 'nl', 'de'] } })
        .where(eq(site.id, world.ctx.site.id))
      const after = await call(client, 'get_release_status', {})
      expect(after.data?.languageChange).toEqual({
        added: ['de'],
        removed: [],
        mainChanged: null,
      })
      expect(after.data?.pendingCount).toBe(1)
    } finally {
      await db.delete(publication).where(eq(publication.id, publicationId))
      await db
        .update(site)
        .set({ languages: null })
        .where(eq(site.id, world.ctx.site.id))
    }
  })

  it('refuses an agency schema change that would delete a field with content', async () => {
    const { token } = await world.keyFor(world.agency, 'agency', {
      name: 'Schema drop',
    })
    const client = await connect(token)
    const created = await call(client, 'create_entry', {
      collection: 'posts',
      fields: {
        title: 'Excerpt holder',
        slug: 'excerpt-holder-schema',
        body: 'Body.',
        excerpt: 'This content would be deleted.',
      },
    })
    expect(created.isError).toBe(false)

    const refused = await call(client, 'upsert_collection', {
      key: 'posts',
      label: 'Posts',
      routePattern: '/blog/$slug',
      fields: [
        { key: 'title', label: 'Title', type: 'text', required: true },
        { key: 'slug', label: 'Slug', type: 'slug', required: true },
        { key: 'body', label: 'Body', type: 'richtext', required: true },
      ],
    })
    expect(refused.isError).toBe(true)
    expect(refused.text).toMatch(/excerpt/)
    expect(refused.text).toMatch(/content/)
    expect(refused.text).toMatch(/schema was not changed/)

    const row = (
      await db
        .select()
        .from(collection)
        .where(
          and(
            eq(collection.siteId, world.ctx.site.id),
            eq(collection.key, 'posts'),
          ),
        )
    ).at(0)
    expect(row?.fields.map((field) => field.key)).toContain('excerpt')
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
    const first = prompt.messages.at(0)?.content
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
      Record<string, unknown> | undefined
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
      scope: 'site' as const,
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

// ---------------------------------------------------------------------------
// Site content (globals). Sections are stored as `collection` rows with
// kind = 'global' and exactly one entry with slug '$global'. These tests seed
// them directly so they do not depend on the agency tools they also cover.
// ---------------------------------------------------------------------------

const GLOBAL_ENTRY_SLUG = '$global'

const COMPANY_FIELDS: Field[] = [
  { key: 'email', label: 'Email', type: 'text', required: true },
  { key: 'phone', label: 'Phone', type: 'text' },
  { key: 'about', label: 'About', type: 'richtext' },
]

const COMPANY_DATA = {
  email: 'hello@example.com',
  phone: '+31 20 123 4567',
  about: sampleRichText,
}

type GlobalSeed = {
  key: string
  label: string
  fields?: Field[]
  enabled?: boolean
  seoEnabled?: boolean
  previewPath?: string | null
  draftData?: Record<string, unknown>
  publishedData?: Record<string, unknown> | null
  status?: 'draft' | 'published'
}

async function seedGlobal(w: World, seed: GlobalSeed) {
  const row = (
    await db
      .insert(collection)
      .values({
        siteId: w.ctx.site.id,
        key: seed.key,
        label: seed.label,
        routePattern: '',
        fields: seed.fields ?? COMPANY_FIELDS,
        enabled: seed.enabled ?? true,
        kind: 'global',
        seoEnabled: seed.seoEnabled ?? false,
        previewPath: seed.previewPath ?? null,
      })
      .returning()
  ).at(0)
  if (!row) throw new Error('global insert failed')
  const created = (
    await db
      .insert(entry)
      .values({
        siteId: w.ctx.site.id,
        collectionId: row.id,
        slug: GLOBAL_ENTRY_SLUG,
        status: seed.status ?? 'draft',
        draftData: seed.draftData ?? {},
        publishedData: seed.publishedData ?? null,
        publishedAt: seed.publishedData ? new Date() : null,
        createdBy: w.owner,
        updatedBy: w.owner,
      })
      .returning()
  ).at(0)
  if (!created) throw new Error('global entry insert failed')
  return { collectionId: row.id, entryId: created.id }
}

/** companyInfo (enabled, no SEO, no preview), homePage (SEO, preview "/"), retiredNotes (disabled). */
async function seedSiteContent(w: World) {
  const company = await seedGlobal(w, {
    key: 'companyInfo',
    label: 'Company info',
    draftData: COMPANY_DATA,
  })
  const home = await seedGlobal(w, {
    key: 'homePage',
    label: 'Home page',
    fields: [{ key: 'heading', label: 'Heading', type: 'text' }],
    seoEnabled: true,
    previewPath: '/',
    draftData: { heading: 'Welcome' },
  })
  const retired = await seedGlobal(w, {
    key: 'retiredNotes',
    label: 'Retired notes',
    fields: [{ key: 'note', label: 'Note', type: 'text' }],
    enabled: false,
    draftData: { note: 'Old' },
  })
  return { company, home, retired }
}

async function clientFor(
  w: World,
  role: Role,
  name: string,
  options: { allowGoLive?: boolean } = {},
) {
  const userId =
    role === 'editor' ? w.editor : role === 'agency' ? w.agency : w.owner
  const { token } = await w.keyFor(userId, role, {
    name,
    allowGoLive: options.allowGoLive,
  })
  return connect(token)
}

/** Like call(), for tools that return a JSON array (data is only set for objects). */
async function callArray(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
): Promise<Record<string, unknown>[]> {
  const result = await client.callTool({ name, arguments: args })
  expect(result.isError).toBeFalsy()
  const first = result.content.at(0)
  const parsed: unknown = JSON.parse(
    first?.type === 'text' ? first.text : 'null',
  )
  return Array.isArray(parsed) ? (parsed as Record<string, unknown>[]) : []
}

describe.skipIf(!hasDb)('site content (globals)', () => {
  let w: World

  beforeEach(async () => {
    w = await buildWorld()
  })

  afterEach(async () => {
    await w.cleanup()
  })

  it('lists enabled sections in get_site_info, hiding disabled ones from editors and owners', async () => {
    await seedSiteContent(w)
    const enabledShape = [
      expect.objectContaining({
        key: 'companyInfo',
        label: 'Company info',
        enabled: true,
        fieldCount: 3,
        seo: false,
        previewPath: null,
      }),
      expect.objectContaining({
        key: 'homePage',
        label: 'Home page',
        enabled: true,
        fieldCount: 1,
        seo: true,
        previewPath: '/',
      }),
    ]

    const editorInfo = await call(
      await clientFor(w, 'editor', 'Globals info editor'),
      'get_site_info',
    )
    expect(editorInfo.isError).toBe(false)
    const editorGlobals = editorInfo.data?.globals as { key: string }[]
    expect(editorGlobals).toEqual(expect.arrayContaining(enabledShape))
    expect(editorGlobals.map((item) => item.key)).not.toContain('retiredNotes')
    expect(String(editorInfo.data?.guide)).toMatch(/site content|global/i)

    // Globals are not collections: they never appear in the collections list.
    const collectionKeys = (
      editorInfo.data?.collections as { key: string }[]
    ).map((item) => item.key)
    expect(collectionKeys).toContain('posts')
    expect(collectionKeys).not.toContain('companyInfo')
    expect(collectionKeys).not.toContain('homePage')

    const ownerInfo = await call(
      await clientFor(w, 'owner', 'Globals info owner'),
      'get_site_info',
    )
    const ownerGlobals = ownerInfo.data?.globals as { key: string }[]
    expect(ownerGlobals).toEqual(expect.arrayContaining(enabledShape))
    expect(ownerGlobals.map((item) => item.key)).not.toContain('retiredNotes')

    const agencyInfo = await call(
      await clientFor(w, 'agency', 'Globals info agency'),
      'get_site_info',
    )
    const agencyGlobals = agencyInfo.data?.globals as {
      key: string
      enabled: boolean
    }[]
    expect(agencyGlobals).toEqual(expect.arrayContaining(enabledShape))
    expect(agencyGlobals).toContainEqual(
      expect.objectContaining({ key: 'retiredNotes', enabled: false }),
    )
  })

  it('offers the global tools to every role, and the definition tools only to agency admins', async () => {
    const readWrite = ['get_global', 'update_global', 'discard_global_draft']
    const definition = ['upsert_global', 'delete_global']

    for (const role of ['editor', 'owner'] as const) {
      const names = await toolNames(await clientFor(w, role, `Vis ${role}`))
      expect(names).toEqual(expect.arrayContaining(readWrite))
      for (const name of definition) expect(names).not.toContain(name)
    }

    const agencyNames = await toolNames(
      await clientFor(w, 'agency', 'Vis agency'),
    )
    expect(agencyNames).toEqual(
      expect.arrayContaining([...readWrite, ...definition]),
    )
  })

  it('returns a section with status, schema, values, and SEO and preview only when they apply', async () => {
    const { company, home } = await seedSiteContent(w)
    const client = await clientFor(w, 'editor', 'Get global')

    const read = await call(client, 'get_global', { global: 'companyInfo' })
    expect(read.isError).toBe(false)
    expect(read.data).toMatchObject({
      id: company.entryId,
      key: 'companyInfo',
      label: 'Company info',
      status: 'draft',
      live: false,
      pendingRelease: false,
      version: 1,
      editedSinceReady: false,
      previewAvailable: false,
    })
    expect(
      (
        read.data?.fields as { key: string; type: string; required: boolean }[]
      ).map((field) => [field.key, field.type, field.required]),
    ).toEqual([
      ['email', 'text', true],
      ['phone', 'text', false],
      ['about', 'richtext', false],
    ])
    expect(read.data).toHaveProperty('example')
    expect(read.data?.values).toMatchObject({
      email: 'hello@example.com',
      phone: '+31 20 123 4567',
    })
    // Rich text comes back as Markdown, not as the stored editor document.
    expect(
      String((read.data?.values as Record<string, unknown>).about),
    ).toContain('Hello world')
    expect(read.data).not.toHaveProperty('seo')

    const withSeo = await call(client, 'get_global', { global: 'homePage' })
    expect(withSeo.isError).toBe(false)
    expect(withSeo.data).toMatchObject({
      id: home.entryId,
      status: 'draft',
      previewAvailable: true,
      values: { heading: 'Welcome' },
    })
    expect(withSeo.data).toHaveProperty('seo')

    const unknown = await call(client, 'get_global', { global: 'nope' })
    expect(unknown.isError).toBe(true)
    expect(unknown.text).toContain('nope')

    const disabledForEditor = await call(client, 'get_global', {
      global: 'retiredNotes',
    })
    expect(disabledForEditor.isError).toBe(true)

    const agencyRead = await call(
      await clientFor(w, 'agency', 'Get global agency'),
      'get_global',
      { global: 'retiredNotes' },
    )
    expect(agencyRead.isError).toBe(false)
    expect(agencyRead.data).toMatchObject({ key: 'retiredNotes' })
  })

  it('treats a disabled section entry as not found by entry id, for owners; agency admins still reach it', async () => {
    const { retired } = await seedSiteContent(w)
    const id = retired.entryId
    const owner = await clientFor(w, 'owner', 'Retired by id owner', {
      allowGoLive: true,
    })
    const publishAt = new Date(Date.now() + 86_400_000).toISOString()
    const attempts: [string, Record<string, unknown>][] = [
      ['get_entry', { id }],
      ['mark_ready', { id }],
      ['schedule_entry', { id, publishAt, timezone: 'UTC' }],
      ['list_revisions', { id }],
      [
        'restore_revision',
        { id, revisionId: 'rev-missing', expectedVersion: 1 },
      ],
      ['get_preview_url', { id }],
    ]
    for (const [name, args] of attempts) {
      const out = await call(owner, name, args)
      expect(out.isError, name).toBe(true)
      expect(out.text, name).toMatch(/No (entry with id|site content)/)
    }

    const [row] = await db.select().from(entry).where(eq(entry.id, id))
    expect(row).toMatchObject({ status: 'draft' })

    const agency = await clientFor(w, 'agency', 'Retired by id agency')
    const revisions = await call(agency, 'list_revisions', { id })
    expect(revisions.isError).toBe(false)
  })

  it('previews a section through its previewPath and refuses when there is none', async () => {
    const { company, home } = await seedSiteContent(w)
    const owner = await clientFor(w, 'owner', 'Global preview')

    const preview = await call(owner, 'get_preview_url', { id: home.entryId })
    expect(preview.isError).toBe(false)
    expect(String(preview.data?.url)).toMatch(/\/\?arecaPreview=/)

    const none = await call(owner, 'get_preview_url', { id: company.entryId })
    expect(none.isError).toBe(true)
  })

  it('updates only the fields sent, stores rich text from Markdown, and checks the version', async () => {
    const { company } = await seedSiteContent(w)
    const client = await clientFor(w, 'editor', 'Update global')

    const updated = await call(client, 'update_global', {
      global: 'companyInfo',
      fields: { email: 'team@example.com' },
      expectedVersion: 1,
    })
    expect(updated.isError).toBe(false)
    const after = await storedEntry(company.entryId)
    expect(after.draftData.email).toBe('team@example.com')
    expect(after.draftData.phone).toBe(COMPANY_DATA.phone)
    expect(after.draftData.about).toEqual(COMPANY_DATA.about)
    expect(after.draftVersion).toBe(2)

    const markdown = await call(client, 'update_global', {
      global: 'companyInfo',
      fields: { about: '## Our story\n\nWe roast **slowly**.' },
    })
    expect(markdown.isError).toBe(false)
    const stored = await storedEntry(company.entryId)
    expect((stored.draftData.about as { type: string }).type).toBe('doc')
    const read = await call(client, 'get_global', { global: 'companyInfo' })
    expect(read.data?.values).toMatchObject({ email: 'team@example.com' })
    expect(
      String((read.data?.values as Record<string, unknown>).about),
    ).toContain('## Our story')

    const stale = await call(client, 'update_global', {
      global: 'companyInfo',
      fields: { phone: 'Too late' },
      expectedVersion: 1,
    })
    expect(stale.isError).toBe(true)
    expect(stale.text).toMatch(/get_(global|entry)/)
    expect((await storedEntry(company.entryId)).draftData.phone).toBe(
      COMPANY_DATA.phone,
    )
  })

  it('refuses seo on a section without SEO, and saves it on one with SEO', async () => {
    const { company } = await seedSiteContent(w)
    const client = await clientFor(w, 'editor', 'Global seo')

    const refused = await call(client, 'update_global', {
      global: 'companyInfo',
      seo: { title: 'Not allowed here' },
    })
    expect(refused.isError).toBe(true)
    expect(refused.text).toMatch(/SEO/i)
    expect((await storedEntry(company.entryId)).draftData).not.toHaveProperty(
      '$seo',
    )

    const saved = await call(client, 'update_global', {
      global: 'homePage',
      seo: { title: 'Home title' },
    })
    expect(saved.isError).toBe(false)
    const home = await call(client, 'get_global', { global: 'homePage' })
    expect(home.data?.seo).toMatchObject({ title: 'Home title' })
  })

  it('discards the draft back to the ready values, and refuses when the section was never ready', async () => {
    const { company } = await seedSiteContent(w)
    const owner = await clientFor(w, 'owner', 'Discard owner')
    const ready = await call(owner, 'mark_ready', { id: company.entryId })
    expect(ready.isError).toBe(false)

    const editor = await clientFor(w, 'editor', 'Discard editor')
    const edit = await call(editor, 'update_global', {
      global: 'companyInfo',
      fields: { email: 'draft@example.com' },
    })
    expect(edit.isError).toBe(false)
    const edited = await call(editor, 'get_global', { global: 'companyInfo' })
    expect(edited.data).toMatchObject({
      editedSinceReady: true,
      values: { email: 'draft@example.com' },
    })

    const discarded = await call(editor, 'discard_global_draft', {
      global: 'companyInfo',
    })
    expect(discarded.isError).toBe(false)
    const after = await call(editor, 'get_global', { global: 'companyInfo' })
    expect(after.data?.values).toMatchObject({
      email: COMPANY_DATA.email,
      phone: COMPANY_DATA.phone,
    })
    expect(after.data).toMatchObject({ editedSinceReady: false })
    expect(Number(after.data?.version)).toBeGreaterThan(
      Number(edited.data?.version),
    )

    const revisions = await callArray(editor, 'list_revisions', {
      id: company.entryId,
    })
    expect(revisions.map((rev) => rev.note)).toContain('discard')

    await seedGlobal(w, {
      key: 'aboutPage',
      label: 'About page',
      fields: [{ key: 'heading', label: 'Heading', type: 'text' }],
      draftData: { heading: 'Draft only' },
    })
    const never = await call(editor, 'discard_global_draft', {
      global: 'aboutPage',
    })
    expect(never.isError).toBe(true)
  })

  it('lets owners approve, schedule and restore a section by its entry id, and keeps editors from approving', async () => {
    const { company } = await seedSiteContent(w)
    const id = company.entryId

    const editor = await clientFor(w, 'editor', 'Workflow editor')
    let refused: CallOutcome | Error
    try {
      refused = await call(editor, 'mark_ready', { id })
    } catch (error) {
      refused = error as Error
    }
    expect(refused instanceof Error || refused.isError).toBe(true)
    expect((await storedEntry(id)).status).toBe('draft')

    const owner = await clientFor(w, 'owner', 'Workflow owner', {
      allowGoLive: true,
    })
    const ready = await call(owner, 'mark_ready', { id })
    expect(ready.isError).toBe(false)
    expect(ready.data).toMatchObject({
      status: 'ready',
      live: false,
      pendingRelease: true,
    })

    const edit = await call(owner, 'update_global', {
      global: 'companyInfo',
      fields: { phone: '+31 20 999 0000' },
    })
    expect(edit.isError).toBe(false)

    const scheduled = await call(owner, 'schedule_entry', {
      id,
      publishAt: FUTURE,
      timezone: 'Europe/Amsterdam',
    })
    expect(scheduled.isError).toBe(false)
    expect((await storedEntry(id)).status).toBe('scheduled')

    const cancelled = await call(owner, 'cancel_schedule', { id })
    expect(cancelled.isError).toBe(false)
    expect(cancelled.data?.status).toBe('ready')

    const revisions = await callArray(owner, 'list_revisions', { id })
    expect(revisions.length).toBeGreaterThan(0)
    const restored = await call(owner, 'restore_revision', {
      id,
      revisionId: String(revisions.at(-1)?.id),
    })
    expect(restored.isError).toBe(false)
  })

  it('refuses unpublish, archive and delete on a section, and treats sections as unknown collections', async () => {
    const { company } = await seedSiteContent(w)
    const owner = await clientFor(w, 'owner', 'Refuse owner')

    for (const name of ['unpublish_entry', 'archive_entry', 'delete_entry']) {
      const outcome = await call(owner, name, { id: company.entryId })
      expect(outcome.isError, name).toBe(true)
      expect(outcome.text, name).toMatch(/site content|global/i)
    }
    // The section's entry survives every refused call.
    expect((await storedEntry(company.entryId)).slug).toBe(GLOBAL_ENTRY_SLUG)

    const created = await call(owner, 'create_entry', {
      collection: 'companyInfo',
      fields: { email: 'nope@example.com' },
    })
    expect(created.isError).toBe(true)
    expect(created.text).toContain('No collection "companyInfo"')

    const schema = await call(owner, 'get_collection_schema', {
      collection: 'companyInfo',
    })
    expect(schema.isError).toBe(true)
    expect(schema.text).toContain('No collection "companyInfo"')

    const listed = await call(owner, 'list_entries', {
      collection: 'companyInfo',
    })
    expect(listed.isError).toBe(true)
    expect(listed.text).toContain('No collection "companyInfo"')
  })

  it('does not reveal a disabled section through the "No collection" hint', async () => {
    await seedSiteContent(w)
    const owner = await clientFor(w, 'owner', 'Hint owner')
    const editor = await clientFor(w, 'editor', 'Hint editor')

    for (const actor of [owner, editor]) {
      const disabled = await call(actor, 'get_collection_schema', {
        collection: 'retiredNotes',
      })
      const missing = await call(actor, 'get_collection_schema', {
        collection: 'nothingLikeThis',
      })
      expect(disabled.isError).toBe(true)
      expect(missing.isError).toBe(true)
      expect(disabled.text).not.toMatch(/site content|get_global|update_global/)
      // Same message as for a key that does not exist, bar the key itself.
      expect(disabled.text.replaceAll('retiredNotes', 'KEY')).toBe(
        missing.text.replaceAll('nothingLikeThis', 'KEY'),
      )
    }
  })

  it('lets an agency admin create, redefine and delete a section, keeping one entry for it', async () => {
    const agency = await clientFor(w, 'agency', 'Globals agency')

    const created = await call(agency, 'upsert_global', {
      key: 'footerInfo',
      label: 'Footer',
      fields: [{ key: 'copyright', label: 'Copyright', type: 'text' }],
      seo: false,
      enabled: true,
    })
    expect(created.isError).toBe(false)

    const [col] = await db
      .select()
      .from(collection)
      .where(
        and(
          eq(collection.siteId, w.ctx.site.id),
          eq(collection.key, 'footerInfo'),
        ),
      )
    expect(col).toMatchObject({
      kind: 'global',
      label: 'Footer',
      enabled: true,
    })
    const entries = await db
      .select()
      .from(entry)
      .where(eq(entry.collectionId, col.id))
    expect(entries.map((item) => item.slug)).toEqual([GLOBAL_ENTRY_SLUG])
    const entryId = entries[0].id

    const redefined = await call(agency, 'upsert_global', {
      key: 'footerInfo',
      label: 'Footer',
      fields: [
        { key: 'copyright', label: 'Copyright', type: 'text' },
        { key: 'phone', label: 'Phone', type: 'text', group: 'Contact' },
      ],
      seo: false,
    })
    expect(redefined.isError).toBe(false)
    const read = await call(agency, 'get_global', { global: 'footerInfo' })
    expect(read.data?.id).toBe(entryId)
    expect(
      (read.data?.fields as { key: string }[]).map((field) => field.key),
    ).toEqual(['copyright', 'phone'])
    const afterRedefine = await db
      .select()
      .from(entry)
      .where(eq(entry.collectionId, col.id))
    expect(afterRedefine).toHaveLength(1)

    const withSlug = await call(agency, 'upsert_global', {
      key: 'badInfo',
      label: 'Bad',
      fields: [{ key: 'slug', label: 'Slug', type: 'slug' }],
    })
    expect(withSlug.isError).toBe(true)
    expect(withSlug.text).toMatch(/slug/i)

    const reserved = await call(agency, 'upsert_global', {
      key: 'globals',
      label: 'Globals',
      fields: [{ key: 'copyright', label: 'Copyright', type: 'text' }],
    })
    expect(reserved.isError).toBe(true)

    const groupedCollection = await call(agency, 'upsert_collection', {
      key: 'grouped',
      label: 'Grouped',
      routePattern: '/grouped/$slug',
      fields: [
        { key: 'slug', label: 'Slug', type: 'slug' },
        { key: 'title', label: 'Title', type: 'text', group: 'Main' },
      ],
    })
    expect(groupedCollection.isError).toBe(true)

    const deleted = await call(agency, 'delete_global', { key: 'footerInfo' })
    expect(deleted.isError).toBe(false)
    const remaining = await db
      .select()
      .from(collection)
      .where(
        and(
          eq(collection.siteId, w.ctx.site.id),
          eq(collection.key, 'footerInfo'),
        ),
      )
    expect(remaining).toHaveLength(0)
    const archived = await db
      .select()
      .from(deletedContentArchive)
      .where(inArray(deletedContentArchive.entityId, [col.id, entryId]))
    expect(archived.length).toBeGreaterThan(0)
    expect(
      (await call(agency, 'get_global', { global: 'footerInfo' })).isError,
    ).toBe(true)
  })

  it('mentions site content in the server instructions for editors and agency admins', async () => {
    const editor = await clientFor(w, 'editor', 'Instr globals editor')
    expect(editor.getInstructions()).toMatch(/site content|globals/i)

    const agency = await clientFor(w, 'agency', 'Instr globals agency')
    expect(agency.getInstructions()).toMatch(/site content|globals/i)
  })
})
