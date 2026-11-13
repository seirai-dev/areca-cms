/* eslint-disable @typescript-eslint/no-unnecessary-condition -- row lookups are checked defensively */
import { and, eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { db } from '#/db'
import {
  auditLog,
  mcpConnection,
  membership,
  oauthClient,
  user,
} from '#/db/schema'
import { NotFoundError } from '#/server/content/errors'
import { cleanupTestSite, createTestSite } from '#/server/content/test-utils'

import {
  findUsableConnection,
  isConnectionUsable,
  listConnections,
  revokeConnection,
  saveConnectionApproval,
  touchConnection,
  withConnectionLock,
} from './connections'
import { MCP_CONNECTION_IDLE_MS } from './oauth-resource'

const hasDb = Boolean(process.env.DATABASE_URL)
const DAY_MS = 24 * 60 * 60 * 1000

describe('isConnectionUsable', () => {
  const now = new Date('2026-10-10T12:00:00Z')

  it('treats a revoked connection as unusable', () => {
    expect(
      isConnectionUsable(
        { revokedAt: now, lastUsedAt: now, createdAt: now },
        now,
      ),
    ).toBe(false)
  })

  it('expires a connection unused for 90 days, and keeps one used 89 days ago', () => {
    const createdLongAgo = new Date(now.getTime() - 400 * DAY_MS)
    expect(
      isConnectionUsable(
        { revokedAt: null, lastUsedAt: null, createdAt: createdLongAgo },
        now,
      ),
    ).toBe(false)
    expect(MCP_CONNECTION_IDLE_MS).toBe(90 * DAY_MS)
    expect(
      isConnectionUsable(
        {
          revokedAt: null,
          lastUsedAt: new Date(now.getTime() - 89 * DAY_MS),
          createdAt: createdLongAgo,
        },
        now,
      ),
    ).toBe(true)
    expect(
      isConnectionUsable(
        {
          revokedAt: null,
          lastUsedAt: new Date(now.getTime() - 91 * DAY_MS),
          createdAt: createdLongAgo,
        },
        now,
      ),
    ).toBe(false)
  })
})

describe.skipIf(!hasDb)('MCP connections', () => {
  let ctx: Awaited<ReturnType<typeof createTestSite>>
  let owner: string
  let editor: string
  let editorTwo: string
  const clientId = `connections-test-${crypto.randomUUID()}`

  beforeAll(async () => {
    ctx = await createTestSite()
    const make = async (label: string, role: 'owner' | 'editor') => {
      const id = crypto.randomUUID()
      await db.insert(user).values({
        id,
        name: label,
        email: `${label}-${id}@test.local`,
        emailVerified: true,
      })
      await db
        .insert(membership)
        .values({ userId: id, organizationId: ctx.org.id, role })
      return id
    }
    owner = await make('conn-owner', 'owner')
    editor = await make('conn-editor', 'editor')
    editorTwo = await make('conn-editor-two', 'editor')
    await db.insert(oauthClient).values({
      clientId,
      redirectUris: ['http://localhost:9999/callback'],
      name: 'Connections test app',
    })
  })

  afterAll(async () => {
    await db.delete(oauthClient).where(eq(oauthClient.clientId, clientId))
    await db.delete(user).where(inArray(user.id, [owner, editor, editorTwo]))
    await cleanupTestSite(ctx)
  })

  const connect = (
    userId: string,
    allowGoLive = false,
    clientName = 'Connections test app',
  ) => {
    const input = {
      userId,
      siteId: ctx.site.id,
      organizationId: ctx.org.id,
      clientId,
      clientName,
      allowGoLive,
    }
    return withConnectionLock(input, async () => {
      const now = new Date()
      const existing = await findUsableConnection({ ...input, now })
      return saveConnectionApproval(
        input,
        existing?.id ?? crypto.randomUUID(),
        now,
      )
    })
  }

  it('keeps one active connection per user, site and app, and updates it on re-approval', async () => {
    const first = await connect(owner, false)
    const second = await connect(owner, true, 'Renamed app')
    expect(second.id).toBe(first.id)
    expect(second.allowGoLive).toBe(true)
    expect(second.clientName).toBe('Renamed app')

    const rows = await db
      .select()
      .from(mcpConnection)
      .where(
        and(
          eq(mcpConnection.userId, owner),
          eq(mcpConnection.siteId, ctx.site.id),
          eq(mcpConnection.clientId, clientId),
        ),
      )
    expect(rows).toHaveLength(1)

    const log = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.targetId, first.id))
    expect(log.map((row) => row.action)).toContain('mcp_connection.create')
  })

  it('serializes simultaneous approvals without creating duplicates', async () => {
    const results = await Promise.all(
      Array.from({ length: 12 }, () => connect(owner, true, 'Renamed app')),
    )
    expect(new Set(results.map((row) => row.id)).size).toBe(1)
  })

  it('shows owners every connection on the site and editors only their own', async () => {
    await connect(editor, false)
    await connect(editorTwo, false)

    const forOwner = await listConnections({
      siteId: ctx.site.id,
      userId: owner,
      includeAllUsers: true,
    })
    expect(forOwner.map((row) => row.userId).sort()).toEqual(
      [owner, editor, editorTwo].sort(),
    )

    const forEditor = await listConnections({
      siteId: ctx.site.id,
      userId: editor,
      includeAllUsers: false,
    })
    expect(forEditor.map((row) => row.userId)).toEqual([editor])
  })

  it('lets an editor disconnect only their own app, and an owner disconnect any', async () => {
    const [mine] = await db
      .select()
      .from(mcpConnection)
      .where(
        and(
          eq(mcpConnection.userId, editorTwo),
          eq(mcpConnection.siteId, ctx.site.id),
        ),
      )
    expect(mine).toBeDefined()

    await expect(
      revokeConnection({
        id: mine?.id ?? '',
        siteId: ctx.site.id,
        actorId: editor,
        organizationId: ctx.org.id,
        canRevokeOthers: false,
      }),
    ).rejects.toBeInstanceOf(NotFoundError)

    await revokeConnection({
      id: mine?.id ?? '',
      siteId: ctx.site.id,
      actorId: owner,
      organizationId: ctx.org.id,
      canRevokeOthers: true,
    })

    const remaining = await listConnections({
      siteId: ctx.site.id,
      userId: owner,
      includeAllUsers: true,
    })
    expect(remaining.map((row) => row.userId)).not.toContain(editorTwo)
    expect(
      await findUsableConnection({
        userId: editorTwo,
        siteId: ctx.site.id,
        clientId,
      }),
    ).toBeNull()
  })

  it('records the disconnect in the activity log, and a second disconnect changes nothing', async () => {
    const [ownerRow] = await db
      .select()
      .from(mcpConnection)
      .where(
        and(
          eq(mcpConnection.userId, owner),
          eq(mcpConnection.siteId, ctx.site.id),
        ),
      )
    expect(ownerRow).toBeDefined()
    const revoke = () =>
      revokeConnection({
        id: ownerRow?.id ?? '',
        siteId: ctx.site.id,
        actorId: owner,
        organizationId: ctx.org.id,
        canRevokeOthers: true,
      })
    await revoke()
    await revoke()

    const log = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.targetId, ownerRow?.id ?? ''))
    const revokes = log.filter((row) => row.action === 'mcp_connection.revoke')
    expect(revokes).toHaveLength(1)
    // The row as it stood when it was disconnected (renamed and go-live on).
    expect(revokes[0]?.meta).toMatchObject({
      clientName: 'Renamed app',
      allowGoLive: true,
    })
  })

  it('writes last-used at most once a minute', async () => {
    const [row] = await db
      .insert(mcpConnection)
      .values({
        userId: owner,
        siteId: ctx.site.id,
        clientId,
        clientName: 'Touch test',
        lastUsedAt: new Date(Date.now() - 10_000),
      })
      .returning()
    if (!row) throw new Error('insert failed')
    const recentBefore = row.lastUsedAt
    await touchConnection(row, new Date())
    const [afterRecent] = await db
      .select()
      .from(mcpConnection)
      .where(eq(mcpConnection.id, row.id))
    expect(afterRecent?.lastUsedAt).toEqual(recentBefore)

    const later = new Date(Date.now() + 120_000)
    await touchConnection(row, later)
    const [afterLater] = await db
      .select()
      .from(mcpConnection)
      .where(eq(mcpConnection.id, row.id))
    expect(afterLater?.lastUsedAt?.getTime()).toBe(later.getTime())
  })
})
