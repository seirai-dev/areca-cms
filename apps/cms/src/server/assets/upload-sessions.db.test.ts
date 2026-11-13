/* eslint-disable @typescript-eslint/no-unnecessary-condition -- tool results are read loosely in assertions */
import { eq } from 'drizzle-orm'
import sharp from 'sharp'
import {
  Client,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { db } from '#/db'
import {
  asset,
  assetUploadSession,
  mcpConnection,
  mcpKey,
  membership,
  oauthClient,
  user,
} from '#/db/schema'
import { cleanupTestSite, createTestSite } from '#/server/content/test-utils'
import { handleMcpRequest } from '#/server/mcp/http'
import { createMcpKey } from '#/server/mcp/keys'

import {
  handleSessionFinish,
  handleSessionInfo,
  handleSessionUpload,
} from './upload-session-http'
import { createUploadSession, UPLOAD_SESSION_TTL_MS } from './upload-sessions'

const hasDb = Boolean(process.env.DATABASE_URL)
const MCP_URL = 'https://cms.test/api/mcp'

type ToolOutcome = {
  isError: boolean
  data: Record<string, unknown>
  images: { data: string; mimeType: string }[]
  text: string
}

async function connect(token: string) {
  const client = new Client({ name: 'upload-test', version: '1.0.0' })
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
): Promise<ToolOutcome> {
  const result = await client.callTool({ name, arguments: args })
  const content = result.content as {
    type: string
    text?: string
    data?: string
    mimeType?: string
  }[]
  const text = content.find((part) => part.type === 'text')?.text ?? ''
  let data: Record<string, unknown> = {}
  try {
    data = JSON.parse(text) as Record<string, unknown>
  } catch {
    data = {}
  }
  return {
    isError: Boolean(result.isError),
    data,
    text,
    images: content
      .filter((part) => part.type === 'image')
      .map((part) => ({
        data: part.data ?? '',
        mimeType: part.mimeType ?? '',
      })),
  }
}

async function png(color: string, width = 1600, height = 900) {
  return sharp({
    create: { width, height, channels: 3, background: color },
  })
    .png()
    .toBuffer()
}

/** The token at the end of an upload URL. */
function tokenOf(url: unknown): string {
  return String(url).split('/').at(-1) ?? ''
}

function put(token: string, body: Buffer, filename?: string) {
  const request = new Request(`https://cms.test/api/upload/${token}`, {
    method: 'PUT',
    body: new Uint8Array(body),
  })
  return handleSessionUpload(request, token, filename)
}

describe.skipIf(!hasDb)('upload links over MCP', () => {
  let ctx: Awaited<ReturnType<typeof createTestSite>>
  let other: Awaited<ReturnType<typeof createTestSite>>
  let owner: Client
  let editor: Client
  let editorId: string

  beforeAll(async () => {
    ctx = await createTestSite()
    other = await createTestSite()
    await db.insert(membership).values({
      userId: ctx.actor.id,
      organizationId: ctx.org.id,
      role: 'owner',
    })
    editorId = crypto.randomUUID()
    await db.insert(user).values({
      id: editorId,
      name: 'editor',
      email: `editor-${editorId}@test.local`,
      emailVerified: true,
    })
    await db
      .insert(membership)
      .values({ userId: editorId, organizationId: ctx.org.id, role: 'editor' })
    const keyFor = async (userId: string, role: 'owner' | 'editor') =>
      connect(
        (
          await createMcpKey({
            userId,
            siteId: ctx.site.id,
            organizationId: ctx.org.id,
            name: `${role} key`,
            expiresInDays: 30,
            allowGoLive: false,
            role,
          })
        ).token,
      )
    owner = await keyFor(ctx.actor.id, 'owner')
    editor = await keyFor(editorId, 'editor')
  })

  afterAll(async () => {
    if (ctx) await cleanupTestSite(ctx)
    if (other) await cleanupTestSite(other)
    if (editorId) await db.delete(user).where(eq(user.id, editorId))
  })

  it('lists the upload tools for editors too', async () => {
    const { tools } = await editor.listTools()
    const names = tools.map((tool) => tool.name)
    expect(names).toContain('create_asset_upload')
    expect(names).toContain('get_asset_upload')
  })

  it('takes several files by curl, then finish: true closes the link and returns previews', async () => {
    const created = await call(owner, 'create_asset_upload', {
      purpose: 'Photos for the trip post',
    })
    expect(created.isError).toBe(false)
    const { uploadId, pageUrl, uploadUrl } = created.data
    expect(String(pageUrl)).toMatch(/\/upload\/areca_up_/)
    expect(String(uploadUrl)).toMatch(/\/api\/upload\/areca_up_/)
    expect(String(created.data.withShell)).toContain('finish: true')
    const token = tokenOf(uploadUrl)

    const info = await (await handleSessionInfo(token)).json()
    expect(info).toMatchObject({
      state: 'open',
      purpose: 'Photos for the trip post',
      maxFiles: 20,
      uploaded: 0,
    })

    const first = await put(token, await png('#ff0000'), 'red beach.png')
    expect(first.status).toBe(201)
    const firstBody = (await first.json()) as Record<string, unknown>
    expect(firstBody).toMatchObject({
      filename: 'red-beach.png',
      mimeType: 'image/png',
      uploaded: 1,
    })
    expect(String(firstBody.next)).toContain('finish: true')
    const second = await put(token, await png('#0000ff'), 'blue.png')
    expect(second.status).toBe(201)

    const open = await call(owner, 'get_asset_upload', { uploadId })
    expect(open.data.state).toBe('open')
    expect(open.data.uploaded).toBe(2)
    expect(String(open.data.next)).toContain('finish: true')

    const finished = await call(owner, 'get_asset_upload', {
      uploadId,
      finish: true,
    })
    expect(finished.data.state).toBe('finished')
    const files = finished.data.files as { assetId: string; filename: string }[]
    expect(files.map((file) => file.filename)).toEqual([
      'red-beach.png',
      'blue.png',
    ])
    expect(finished.images).toHaveLength(2)
    expect(finished.images[0]?.mimeType).toBe('image/jpeg')
    const meta = await sharp(
      Buffer.from(finished.images[0]?.data ?? '', 'base64'),
    ).metadata()
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBe(1024)

    // The link is closed: no more files.
    const late = await put(token, await png('#00ff00'), 'late.png')
    expect(late.status).toBe(410)
    expect(await late.json()).toMatchObject({ error: 'finished' })

    // The files belong to this site's AI connection.
    const listed = await call(owner, 'list_assets', {})
    const listedIds = (listed.data as unknown as { assetId: string }[]).map(
      (row) => row.assetId,
    )
    for (const file of files) expect(listedIds).toContain(file.assetId)

    const one = await call(owner, 'get_asset', { id: files[0]?.assetId })
    expect(one.images).toHaveLength(1)
    expect(one.data.preview).toBe(true)
  })

  it('lets the page finish the link once its files are in', async () => {
    const created = await call(editor, 'create_asset_upload', {})
    const token = tokenOf(created.data.uploadUrl)
    expect((await put(token, await png('#123456'))).status).toBe(201)
    const response = await handleSessionFinish(token)
    expect(await response.json()).toEqual({ state: 'finished' })
    const info = await (await handleSessionInfo(token)).json()
    expect(info).toMatchObject({ state: 'finished', uploaded: 1 })
  })

  it('refuses a file that is not an image or PDF, and frees its slot', async () => {
    const created = await call(owner, 'create_asset_upload', {})
    const token = tokenOf(created.data.uploadUrl)
    const response = await put(token, Buffer.from('<html>nope</html>'), 'x.png')
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: 'invalid_file' })
    const [row] = await db
      .select()
      .from(assetUploadSession)
      .where(eq(assetUploadSession.id, String(created.data.uploadId)))
    expect(row?.reservedCount).toBe(0)
  })

  it('stops at the file cap', async () => {
    const created = await call(owner, 'create_asset_upload', {})
    const token = tokenOf(created.data.uploadUrl)
    await db
      .update(assetUploadSession)
      .set({ reservedCount: 20 })
      .where(eq(assetUploadSession.id, String(created.data.uploadId)))
    const response = await put(token, await png('#abcdef'))
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ error: 'full' })
  })

  it('expires 20 minutes after it was created', async () => {
    const { token } = await createUploadSession(
      {
        organizationId: ctx.org.id,
        siteId: ctx.site.id,
        userId: ctx.actor.id,
      },
      new Date(Date.now() - UPLOAD_SESSION_TTL_MS - 1000),
    )
    const response = await put(token, await png('#999999'))
    expect(response.status).toBe(410)
    expect(await response.json()).toMatchObject({ error: 'expired' })
  })

  it('stops working when the person who opened it loses access', async () => {
    const { token } = await createUploadSession({
      organizationId: other.org.id,
      siteId: other.site.id,
      // A member of ctx's client only: no access to `other`.
      userId: editorId,
    })
    const response = await put(token, await png('#777777'))
    expect(response.status).toBe(404)
    const assets = await db
      .select()
      .from(asset)
      .where(eq(asset.organizationId, other.org.id))
    expect(assets).toHaveLength(0)
  })

  it("does not show one person's upload link to another", async () => {
    const created = await call(owner, 'create_asset_upload', {})
    const peek = await call(editor, 'get_asset_upload', {
      uploadId: created.data.uploadId,
    })
    expect(peek.isError).toBe(true)
    expect(peek.text).toContain('create_asset_upload')
  })

  it('stops working once the key that opened it is revoked', async () => {
    const { token: keyToken, key } = await createMcpKey({
      userId: ctx.actor.id,
      siteId: ctx.site.id,
      organizationId: ctx.org.id,
      name: 'revoked later',
      expiresInDays: 30,
      allowGoLive: false,
      role: 'owner',
    })
    const client = await connect(keyToken)
    const created = await call(client, 'create_asset_upload', {})
    const token = tokenOf(created.data.uploadUrl)
    const [row] = await db
      .select()
      .from(assetUploadSession)
      .where(eq(assetUploadSession.id, String(created.data.uploadId)))
    expect(row).toMatchObject({ mcpKeyId: key.id, mcpConnectionId: null })
    expect((await put(token, await png('#111111'))).status).toBe(201)

    await db
      .update(mcpKey)
      .set({ revokedAt: new Date() })
      .where(eq(mcpKey.id, key.id))
    const assetCount = async () =>
      (
        await db
          .select()
          .from(asset)
          .where(eq(asset.organizationId, ctx.org.id))
      ).length
    const before = await assetCount()

    const response = await put(token, await png('#222222'))
    expect(response.status).toBe(404)
    expect(await assetCount()).toBe(before)
    expect((await handleSessionInfo(token)).status).toBe(404)
    expect((await handleSessionFinish(token)).status).toBe(404)
  })

  it('is deleted with the key that opened it', async () => {
    const { key } = await createMcpKey({
      userId: ctx.actor.id,
      siteId: ctx.site.id,
      organizationId: ctx.org.id,
      name: 'deleted later',
      expiresInDays: 30,
      allowGoLive: false,
      role: 'owner',
    })
    const { token } = await createUploadSession({
      organizationId: ctx.org.id,
      siteId: ctx.site.id,
      userId: ctx.actor.id,
      credential: { kind: 'key', id: key.id },
    })
    await db.delete(mcpKey).where(eq(mcpKey.id, key.id))
    expect((await put(token, await png('#333333'))).status).toBe(404)
  })

  it('stops working once the OAuth connection that opened it is revoked', async () => {
    const clientId = `upload-test-${crypto.randomUUID()}`
    await db.insert(oauthClient).values({
      id: crypto.randomUUID(),
      clientId,
      redirectUris: ['http://localhost/callback'],
    })
    try {
      const [connection] = await db
        .insert(mcpConnection)
        .values({
          userId: ctx.actor.id,
          siteId: ctx.site.id,
          clientId,
          clientName: 'Test app',
        })
        .returning()
      const { token } = await createUploadSession({
        organizationId: ctx.org.id,
        siteId: ctx.site.id,
        userId: ctx.actor.id,
        credential: { kind: 'oauth', id: connection.id },
      })
      expect((await put(token, await png('#444444'))).status).toBe(201)
      await db
        .update(mcpConnection)
        .set({ revokedAt: new Date() })
        .where(eq(mcpConnection.id, connection.id))
      expect((await put(token, await png('#555555'))).status).toBe(404)
    } finally {
      await db.delete(oauthClient).where(eq(oauthClient.clientId, clientId))
    }
  })

  it('keeps working without a credential when no key or connection opened it', async () => {
    const { token } = await createUploadSession({
      organizationId: ctx.org.id,
      siteId: ctx.site.id,
      userId: ctx.actor.id,
    })
    expect((await put(token, await png('#666666'))).status).toBe(201)
    expect((await handleSessionFinish(token)).status).toBe(200)
  })

  it('refuses an unknown link', async () => {
    const response = await put('areca_up_unknown', await png('#000000'))
    expect(response.status).toBe(404)
    expect((await handleSessionInfo('areca_up_unknown')).status).toBe(404)
  })
})
