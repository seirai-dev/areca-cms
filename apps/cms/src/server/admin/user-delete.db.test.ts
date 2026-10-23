/* eslint-disable @typescript-eslint/no-unnecessary-condition -- row lookups after .select() are checked defensively */
import type * as AdminRoster from './agency-admin-roster.ts'

import { and, eq } from 'drizzle-orm'
import { hashPassword } from 'better-auth/crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { db } from '#/db'
import {
  account,
  auditLog,
  emailOutbox,
  entry,
  mcpKey,
  membership,
  notification,
  oauthClient,
  session,
  user,
} from '#/db/schema'
import { ConflictError, ForbiddenError } from '#/server/content/errors'
import { createEntry } from '#/server/content/entries'
import {
  createTestCollection,
  createTestSite,
  sampleRichText,
} from '#/server/content/test-utils'
import { getBranding } from '#/server/admin/branding'
import { generateMcpKey } from '#/server/mcp/keys'
import { renderTemplate } from '#/server/mail/render'
import { cancelAllQueuedNotificationEmails } from '#/server/mail/outbox'

import { LastAgencyAdminError } from './members.ts'
import {
  deleteOwnAccount,
  deleteUser,
  blockUser,
  selfDeleteBlockers,
} from './users.ts'
import { verifySelfDeletion } from './self-delete-verification.ts'
import {
  join,
  makeClient,
  makePerson,
  removeClients,
  removePeople,
} from './account-fixtures.test-utils.ts'

/** When set, the active-admin count only sees these admins (see fixtures). */
const scope = vi.hoisted(() => ({ ids: null as string[] | null }))

vi.mock('./agency-admin-roster.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof AdminRoster>()
  const { scopedActiveAdminCount } =
    await import('./account-fixtures.test-utils.ts')
  return {
    ...actual,
    countActiveAgencyAdmins: (
      tx: Parameters<typeof actual.countActiveAgencyAdmins>[0],
    ) =>
      scope.ids
        ? scopedActiveAdminCount(tx, scope.ids)
        : actual.countActiveAgencyAdmins(tx),
  }
})

const hasDb = Boolean(process.env.DATABASE_URL)

const people: string[] = []
const clients: string[] = []

afterEach(async () => {
  scope.ids = null
  await removePeople(people.splice(0))
  await removeClients(clients.splice(0))
})

async function person(input: Parameters<typeof makePerson>[0] = {}) {
  const row = await makePerson(input)
  people.push(row.id)
  return row
}

async function client(label?: string) {
  const row = await makeClient(label)
  clients.push(row.id)
  return row
}

/** A client with a site, an owner and a member who writes an entry. */
async function contentFixture() {
  const ctx = await createTestSite()
  clients.push(ctx.org.id)
  people.push(ctx.actor.id)
  await createTestCollection(ctx.site.id)
  const writer = await person({ name: 'Wendy Writer' })
  await join(writer.id, ctx.org.id, 'editor')
  return { ...ctx, writer }
}

describe.skipIf(!hasDb)('admin deletes a person', () => {
  it('removes the account, keeps their content with a null author, and keeps other people’s OAuth clients', async () => {
    const admin = await person({ admin: true, name: 'Owen Admin' })
    const fixture = await contentFixture()
    const writer = fixture.writer
    const written = await createEntry({
      siteId: fixture.site.id,
      collectionKey: 'articles',
      data: {
        title: 'Written by Wendy',
        slug: `wendy-${crypto.randomUUID().slice(0, 6)}`,
        body: sampleRichText,
      },
      actorId: writer.id,
    })
    const generated = generateMcpKey()
    await db.insert(mcpKey).values({
      userId: writer.id,
      siteId: fixture.site.id,
      name: 'Laptop',
      tokenPrefix: generated.tokenPrefix,
      tokenHash: generated.tokenHash,
    })
    const clientId = `app-${crypto.randomUUID()}`
    await db.insert(oauthClient).values({
      id: crypto.randomUUID(),
      clientId,
      userId: writer.id,
      redirectUris: ['http://localhost/callback'],
    })
    const [queued] = await db
      .insert(emailOutbox)
      .values({
        kind: 'notification',
        notificationId: crypto.randomUUID(),
        toAddress: writer.email,
        userId: writer.id,
        organizationId: fixture.org.id,
        subject: 'Published',
        template: 'notification',
        params: { userId: writer.id },
        locale: 'en',
        status: 'queued',
      })
      .returning()
    if (!queued) throw new Error('fixture failed')

    await deleteUser({ actorId: admin.id, userId: writer.id })

    // The account and what hangs off it are gone.
    expect(
      await db.select().from(user).where(eq(user.id, writer.id)),
    ).toHaveLength(0)
    expect(
      await db
        .select()
        .from(membership)
        .where(eq(membership.userId, writer.id)),
    ).toHaveLength(0)
    expect(
      await db.select().from(mcpKey).where(eq(mcpKey.userId, writer.id)),
    ).toHaveLength(0)
    expect(
      await db.select().from(session).where(eq(session.userId, writer.id)),
    ).toHaveLength(0)
    // Their content stays, with the author unset.
    const [kept] = await db.select().from(entry).where(eq(entry.id, written.id))
    expect(kept).toBeTruthy()
    expect(kept?.createdBy).toBeNull()
    // Another person's OAuth client survives; only the link is cleared.
    const [oauth] = await db
      .select()
      .from(oauthClient)
      .where(eq(oauthClient.clientId, clientId))
    expect(oauth).toBeTruthy()
    expect(oauth?.userId).toBeNull()
    // Queued notices are cancelled.
    const [cancelled] = await db
      .select()
      .from(emailOutbox)
      .where(eq(emailOutbox.id, queued.id))
    expect(cancelled?.status).toBe('cancelled')
  })

  it('queues the account_deleted notice before the delete, with the name captured for the renderer', async () => {
    const admin = await person({ admin: true, name: 'Owen Admin' })
    const target = await person({ name: 'Tessa Target', locale: 'nl' })

    await deleteUser({ actorId: admin.id, userId: target.id })

    const [notice] = await db
      .select()
      .from(emailOutbox)
      .where(
        and(
          eq(emailOutbox.kind, 'account_deleted'),
          eq(emailOutbox.toAddress, target.email),
        ),
      )
    expect(notice).toMatchObject({
      status: 'queued',
      toAddress: target.email,
      locale: 'nl',
      userId: null,
    })
    expect(notice?.params).toEqual({
      userId: target.id,
      deletedUserName: 'Tessa Target',
      actorName: 'Owen Admin',
      self: false,
      at: expect.any(String),
    })

    // The renderer runs after the account is gone and must still work.
    const mail = await renderTemplate('account_deleted', notice?.params ?? {}, {
      locale: 'nl',
      brand: await getBranding(),
    })
    expect(mail.subject).toBeTruthy()
    expect(mail.html).toContain('Owen Admin')

    const [audit] = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.action, 'user.delete'),
          eq(auditLog.targetId, target.id),
        ),
      )
    expect(audit).toMatchObject({
      actorId: admin.id,
      targetType: 'user',
      meta: expect.objectContaining({
        deletedUserName: 'Tessa Target',
        deletedUserEmail: target.email,
        self: false,
        actorName: 'Owen Admin',
      }),
    })
  })

  it('deleting a person removes their notification rows', async () => {
    const admin = await person({ admin: true })
    const target = await person()
    const [row] = await db
      .insert(notification)
      .values({
        userId: target.id,
        event: 'release.live',
        payload: {
          siteId: crypto.randomUUID(),
          siteName: 'x',
          orgName: 'y',
          recipientRole: 'owner',
        },
        dedupeKey: `release.live:${crypto.randomUUID()}:${target.id}`,
      })
      .returning()
    await deleteUser({ actorId: admin.id, userId: target.id })
    expect(
      await db
        .select()
        .from(notification)
        .where(eq(notification.id, row?.id ?? '')),
    ).toHaveLength(0)
    expect(await cancelAllQueuedNotificationEmails(target.id)).toBe(0)
  })
})

describe.skipIf(!hasDb)('a person deletes their own account', () => {
  it('deletes immediately when no clients or admin role would be left without an owner', async () => {
    const target = await person({ name: 'Solo Sam' })

    await deleteOwnAccount({ userId: target.id })

    expect(
      await db.select().from(user).where(eq(user.id, target.id)),
    ).toHaveLength(0)
    const [audit] = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.action, 'user.delete'),
          eq(auditLog.targetId, target.id),
        ),
      )
    // The row outlives the person, so the actor link is cleared and the name
    // is kept in meta.
    expect(audit).toMatchObject({
      actorId: null,
      meta: expect.objectContaining({ self: true, actorName: 'Solo Sam' }),
    })
    const [notice] = await db
      .select()
      .from(emailOutbox)
      .where(eq(emailOutbox.toAddress, target.email))
    expect(notice).toMatchObject({ kind: 'account_deleted' })
    expect(notice?.params).toEqual(expect.objectContaining({ self: true }))
  })

  it('is refused while they are the only owner of a client, and the error names the clients', async () => {
    const target = await person({ name: 'Only Owner' })
    const onlyOwned = await client('Harbour Works')
    await join(target.id, onlyOwned.id, 'owner')

    await expect(selfDeleteBlockers(target.id)).resolves.toEqual({
      soleOwnerOf: ['Harbour Works'],
      lastAdmin: false,
    })
    const refused = deleteOwnAccount({ userId: target.id })
    await expect(refused).rejects.toBeInstanceOf(ConflictError)
    await expect(refused).rejects.toThrow('Harbour Works')
    expect(
      await db.select().from(user).where(eq(user.id, target.id)),
    ).toHaveLength(1)

    // Once someone else is an owner, the same person can go.
    const successor = await person()
    await join(successor.id, onlyOwned.id, 'owner')
    await deleteOwnAccount({ userId: target.id })
    expect(
      await db.select().from(user).where(eq(user.id, target.id)),
    ).toHaveLength(0)
  })

  it('an editor, or an owner who shares ownership, can delete their account', async () => {
    const shared = await client('Shared Owners')
    const owner = await person()
    const editor = await person()
    await join(owner.id, shared.id, 'owner')
    await join(editor.id, shared.id, 'editor')
    const another = await person()
    await join(another.id, shared.id, 'owner')

    await expect(selfDeleteBlockers(owner.id)).resolves.toMatchObject({
      soleOwnerOf: [],
    })
    await deleteOwnAccount({ userId: owner.id })
    await deleteOwnAccount({ userId: editor.id })
    expect(
      await db.select().from(user).where(eq(user.id, owner.id)),
    ).toHaveLength(0)
  })

  it('is refused for the last active agency admin', async () => {
    const onlyAdmin = await person({ admin: true })
    const blockedAdmin = await person({ admin: true })
    scope.ids = [onlyAdmin.id, blockedAdmin.id]
    await blockUser({ actorId: onlyAdmin.id, userId: blockedAdmin.id })
    await expect(
      deleteOwnAccount({ userId: onlyAdmin.id }),
    ).rejects.toBeInstanceOf(LastAgencyAdminError)
    await expect(selfDeleteBlockers(onlyAdmin.id)).resolves.toMatchObject({
      lastAdmin: true,
    })
  })

  it('a password account must re-enter the password, and a wrong one is refused', async () => {
    const target = await person()
    await db.insert(account).values({
      id: crypto.randomUUID(),
      accountId: target.id,
      providerId: 'credential',
      userId: target.id,
      password: await hashPassword('correct horse battery'),
    })
    const base = {
      userId: target.id,
      twoFactorEnabled: false,
      session: { id: `s-${target.id}`, createdAt: new Date() },
      headers: new Headers(),
    }

    await expect(verifySelfDeletion(base)).rejects.toBeInstanceOf(
      ForbiddenError,
    )
    await expect(
      verifySelfDeletion({ ...base, password: 'wrong password' }),
    ).rejects.toBeInstanceOf(ForbiddenError)
    await expect(
      verifySelfDeletion({ ...base, password: 'correct horse battery' }),
    ).resolves.toBeUndefined()
  })

  it('an SSO-only person with two-factor must send a code, and without two-factor needs nothing more', async () => {
    const withTwoFactor = await person({ twoFactor: true })
    const plain = await person()
    const headers = new Headers()

    await expect(
      verifySelfDeletion({
        userId: withTwoFactor.id,
        twoFactorEnabled: true,
        session: { id: 'sso-session', createdAt: new Date() },
        headers,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError)
    await expect(
      verifySelfDeletion({
        userId: plain.id,
        twoFactorEnabled: false,
        session: { id: 'sso-session-2', createdAt: new Date() },
        headers,
      }),
    ).resolves.toBeUndefined()
  })
})
