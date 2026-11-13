import { createHmac, randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { db } from '#/db'
import { membership, organization, session, user } from '#/db/schema'
import { env } from '#/env'
import { auth } from '#/lib/auth'
import { securityErrorCode } from '#/lib/security-errors'
import { withRequestScope } from '#/server/http/request-scope.server'
import { recordLocalMfaForToken } from '#/server/security/local-mfa'
import { NotFoundError } from './errors.ts'
import { requireEntryAccess } from './access.ts'
import { createEntry } from './entries.ts'
import {
  createTestCollection,
  createTestGlobal,
  createTestSite,
  sampleRichText,
} from './test-utils.ts'

const headersHolder = vi.hoisted(() => ({ current: new Headers() }))
vi.mock('@tanstack/react-start/server', () => ({
  getRequestHeaders: () => headersHolder.current,
}))

const hasDb = Boolean(process.env.DATABASE_URL)

/** A real Better Auth session row and the signed cookie the browser would send. */
async function signedInHeaders(userId: string) {
  const token = randomUUID()
  await db.insert(session).values({
    id: randomUUID(),
    token,
    userId,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  })
  const signature = createHmac('sha256', env.BETTER_AUTH_SECRET)
    .update(token)
    .digest('base64')
  return new Headers({
    cookie: `better-auth.session_token=${encodeURIComponent(`${token}.${signature}`)}`,
  })
}

describe.skipIf(!hasDb)('requireEntryAccess', () => {
  const cleanup: { orgId: string; userIds: string[] }[] = []

  afterEach(async () => {
    vi.restoreAllMocks()
    for (const item of cleanup.splice(0)) {
      await db.delete(organization).where(eq(organization.id, item.orgId))
      for (const id of item.userIds) {
        await db.delete(user).where(eq(user.id, id))
      }
    }
  })

  async function setUp() {
    const ctx = await createTestSite()
    const item = { orgId: ctx.org.id, userIds: [ctx.actor.id] }
    cleanup.push(item)
    await createTestCollection(ctx.site.id)
    const editor = (
      await db
        .insert(user)
        .values({
          id: randomUUID(),
          name: 'Editor',
          email: `editor-${randomUUID()}@test.local`,
          emailVerified: true,
        })
        .returning()
    ).at(0)
    if (!editor) throw new Error('user insert failed')
    item.userIds.push(editor.id)
    await db.insert(membership).values([
      { userId: ctx.actor.id, organizationId: ctx.org.id, role: 'owner' },
      { userId: editor.id, organizationId: ctx.org.id, role: 'editor' },
    ])
    const created = await createEntry({
      siteId: ctx.site.id,
      collectionKey: 'articles',
      data: {
        title: 'Hello',
        slug: `hello-${ctx.suffix}`,
        body: sampleRichText,
      },
      actorId: ctx.actor.id,
    })
    return {
      ctx,
      entryId: created.id,
      ownerHeaders: await signedInHeaders(ctx.actor.id),
      editorHeaders: await signedInHeaders(editor.id),
    }
  }

  it('reads the Better Auth session once per request for an owner-only check', async () => {
    const { entryId, ownerHeaders } = await setUp()
    headersHolder.current = ownerHeaders
    const getSession = vi.spyOn(auth.api, 'getSession')

    const access = await withRequestScope(() =>
      requireEntryAccess(entryId, 'owner'),
    )

    expect(access.entry.id).toBe(entryId)
    expect(getSession).toHaveBeenCalledTimes(1)
  })

  it('still reads the session for each guard outside a request scope', async () => {
    const { entryId, ownerHeaders } = await setUp()
    headersHolder.current = ownerHeaders
    const getSession = vi.spyOn(auth.api, 'getSession')

    await requireEntryAccess(entryId, 'owner')
    await requireEntryAccess(entryId, 'owner')

    expect(getSession).toHaveBeenCalledTimes(2)
  })

  it('trusts the session cookie cache for reads only', async () => {
    const { entryId, ownerHeaders } = await setUp()
    headersHolder.current = ownerHeaders
    const getSession = vi.spyOn(auth.api, 'getSession')

    await withRequestScope(() => requireEntryAccess(entryId), {
      method: 'GET',
    })
    await withRequestScope(() => requireEntryAccess(entryId), {
      method: 'POST',
    })
    await requireEntryAccess(entryId)

    const queries = getSession.mock.calls.map(
      ([options]) => (options as { query?: unknown }).query,
    )
    expect(queries).toEqual([
      undefined,
      { disableCookieCache: true },
      { disableCookieCache: true },
    ])
  })

  it('answers an editor asking for an owner-only entry with 403, as before', async () => {
    const { entryId, editorHeaders } = await setUp()
    headersHolder.current = editorHeaders

    const error = await withRequestScope(() =>
      requireEntryAccess(entryId, 'owner').catch((caught: unknown) => caught),
    )

    expect(error).toBeInstanceOf(Response)
    expect((error as Response).status).toBe(403)
  })

  it('answers a disabled section with NotFound for an editor and an owner', async () => {
    const { ctx, ownerHeaders, editorHeaders } = await setUp()
    const section = await createTestGlobal(ctx.site.id, { enabled: false })

    headersHolder.current = editorHeaders
    await expect(
      withRequestScope(() => requireEntryAccess(section.entry.id)),
    ).rejects.toBeInstanceOf(NotFoundError)

    headersHolder.current = ownerHeaders
    await expect(
      withRequestScope(() => requireEntryAccess(section.entry.id, 'owner')),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('lets an editor reach an enabled section', async () => {
    const { ctx, editorHeaders } = await setUp()
    const section = await createTestGlobal(ctx.site.id, { enabled: true })
    headersHolder.current = editorHeaders

    const access = await withRequestScope(() =>
      requireEntryAccess(section.entry.id),
    )
    expect(access.entry.id).toBe(section.entry.id)
  })
  it('asks a two-factor editor signed in with a provider for a code first', async () => {
    const { entryId, editorHeaders } = await setUp()
    const token = decodeURIComponent(
      editorHeaders.get('cookie')?.split('=')[1] ?? '',
    ).split('.')[0]
    const row = (
      await db.select().from(session).where(eq(session.token, token))
    ).at(0)
    if (!row) throw new Error('session missing')
    await db
      .update(user)
      .set({ twoFactorEnabled: true })
      .where(eq(user.id, row.userId))
    headersHolder.current = editorHeaders

    const refused = await withRequestScope(() =>
      requireEntryAccess(entryId),
    ).catch((error: unknown) => error)
    expect(securityErrorCode(refused)).toBe('MFA_REQUIRED')

    await recordLocalMfaForToken(token)
    const access = await withRequestScope(() => requireEntryAccess(entryId))
    expect(access.entry.id).toBe(entryId)
  })
})
