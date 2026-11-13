import { createHash } from 'node:crypto'

import type * as MailConfig from '#/server/mail/config'
import type * as SecretsKey from '#/server/security/secrets-key'
import type * as MailTransport from '#/server/mail/transport'
/* eslint-disable @typescript-eslint/no-unnecessary-condition -- Drizzle row arrays can be empty at runtime, so lookups stay defensive. */
import { eq, inArray } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { db } from '#/db'
import {
  auditLog,
  emailOutbox,
  invitation,
  organization,
  user,
} from '#/db/schema'
import { ConflictError, NotFoundError } from '#/server/content/errors'
import { setLogSink } from '#/server/log'
import { sendNow } from '#/server/mail/outbox'

import {
  InvitationDeliveryError,
  acceptInvitation,
  getInvitation,
  inviteMember,
  listInvitations,
  regenerateInvitationLink,
  resendInvitation,
  revokeInvitation,
} from './invitations.ts'

// A fixed 32-byte key, so the outbox keeps the link encrypted as it does in
// production. Tests that need "no key" set `secrets.key` to null.
const TEST_SECRETS_KEY = 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE='

// `override` undefined: the real environment (Mailpit). null: no mail
// configured. An object: that host and port, with an optional password.
// `messages` holds every message text handed to SMTP, including failed sends,
// so tests can read the raw link: the database only keeps its hash.
const mail = vi.hoisted(() => ({
  override: undefined as
    undefined | null | { host: string; port: number; password?: string },
  echoFailure: false,
  messages: [] as string[],
}))
const secrets = vi.hoisted((): { key: string | null } => ({
  key: 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=',
}))

vi.mock('#/server/security/secrets-key', async (importOriginal) => {
  const actual = await importOriginal<typeof SecretsKey>()
  return {
    ...actual,
    secretsEncryptionKey: () => secrets.key,
  }
})

vi.mock('#/server/mail/config', async (importOriginal) => {
  const actual = await importOriginal<typeof MailConfig>()
  return {
    ...actual,
    isMailConfigured: async () => {
      if (mail.override === undefined) return actual.isMailConfigured()
      return mail.override !== null
    },
    resolveMailConfig: async () => {
      if (mail.override === undefined) return actual.resolveMailConfig()
      if (mail.override === null) return null
      return {
        source: 'env' as const,
        host: mail.override.host,
        port: mail.override.port,
        secure: 'none' as const,
        username: null,
        password: mail.override.password ?? null,
        from: 'cms@areca.local',
        replyTo: null,
      }
    },
  }
})

vi.mock('#/server/mail/transport', async (importOriginal) => {
  const actual = await importOriginal<typeof MailTransport>()
  return {
    ...actual,
    sendMail: async (
      config: Parameters<typeof actual.sendMail>[0],
      message: Parameters<typeof actual.sendMail>[1],
    ) => {
      mail.messages.push(message.text)
      if (mail.echoFailure) {
        // SMTP errors can echo the password and the message body with its link.
        const link = message.text.match(/https?:\/\/\S+\/invite\/\w+/)?.[0]
        throw new Error(
          `auth SMTP_PASSWORD=smtp-test-secret ${link}\n${message.text}`,
        )
      }
      return actual.sendMail(config, message)
    },
  }
})

const hasDb = Boolean(process.env.DATABASE_URL)

beforeEach(() => {
  mail.override = undefined
  mail.echoFailure = false
  mail.messages = []
  secrets.key = TEST_SECRETS_KEY
})

/** The raw token in the newest invitation link SMTP was given. */
function latestInviteToken() {
  const links = mail.messages.flatMap((text) =>
    [...text.matchAll(/\/invite\/([0-9a-f]{64})/g)].map((match) => match[1]),
  )
  const token = links.at(-1)
  if (!token) throw new Error('no invitation link was sent')
  return token
}

async function fixture() {
  const suffix = crypto.randomUUID()
  const [org] = await db
    .insert(organization)
    .values({ name: `Invites ${suffix}`, slug: `invites-${suffix}` })
    .returning()
  const [actor] = await db
    .insert(user)
    .values({
      id: crypto.randomUUID(),
      name: 'Inviter',
      email: `inviter-${suffix}@test.local`,
      emailVerified: true,
    })
    .returning()
  if (!org || !actor) throw new Error('fixture failed')
  return {
    org,
    actor,
    email: `guest-${suffix}@test.local`,
    cleanup: async () => {
      await db.delete(organization).where(eq(organization.id, org.id))
      await db.delete(user).where(inArray(user.id, [actor.id]))
    },
  }
}

/** Outbox rows for one invitation, oldest first. */
async function outboxFor(invitationId: string) {
  const rows = await db
    .select()
    .from(emailOutbox)
    .where(eq(emailOutbox.kind, 'invitation'))
  return rows
    .filter((row) => row.params.invitationId === invitationId)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
}

/** Waits for Mailpit to receive the newest message to `to`. */
async function mailpitHtml(to: string) {
  const base = process.env.MAILPIT_URL ?? 'http://localhost:8025'
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    // Search by recipient: the inbox is shared by every worker.
    const res = await fetch(
      `${base}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`,
    )
    const data = (await res.json()) as {
      messages?: Array<{ ID: string; To?: Array<{ Address?: string }> }>
    }
    const hit = data.messages?.find((msg) =>
      msg.To?.some((addr) => addr.Address === to),
    )
    if (hit) {
      const full = (await (
        await fetch(`${base}/api/v1/message/${hit.ID}`)
      ).json()) as {
        HTML?: string
        Subject?: string
      }
      return full
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  return null
}

describe.skipIf(!hasDb)('invitation delivery failures', () => {
  it('keeps the invitation queued with the reason, retries on resend, and sends once SMTP works', async () => {
    const f = await fixture()
    try {
      mail.override = { host: 'localhost', port: 1 }
      const failure = await inviteMember({
        organizationId: f.org.id,
        email: f.email,
        role: 'editor',
        actorId: f.actor.id,
      }).catch((error: unknown) => error)
      expect(failure).toBeInstanceOf(InvitationDeliveryError)
      expect((failure as Error).message).toContain(
        "Couldn't reach localhost on port 1",
      )

      const [row] = await listInvitations(f.org.id)
      expect(row).toMatchObject({ email: f.email, deliveryStatus: 'queued' })
      const firstToken = latestInviteToken()
      const [stored] = await db
        .select()
        .from(invitation)
        .where(eq(invitation.id, row.id))
      expect(stored?.lastDeliveryError).toContain(
        "Couldn't reach localhost on port 1",
      )
      expect(stored?.lastSentAt).toBeNull()

      // A plain retry still hits "pending": resending is the way forward.
      await expect(
        inviteMember({
          organizationId: f.org.id,
          email: f.email,
          role: 'editor',
          actorId: f.actor.id,
        }),
      ).rejects.toBeInstanceOf(ConflictError)

      // Resend while SMTP is still down: stays queued, token rotates, and the
      // older queued email is superseded so the old link is never sent.
      await expect(resendInvitation(row.id, f.actor.id)).rejects.toBeInstanceOf(
        InvitationDeliveryError,
      )
      const secondToken = latestInviteToken()
      expect(secondToken).not.toBe(firstToken)
      const [afterFailedResend] = await db
        .select()
        .from(invitation)
        .where(eq(invitation.id, row.id))
      expect(afterFailedResend?.deliveryStatus).toBe('queued')
      expect(await getInvitation(firstToken)).toBeNull()
      expect(await getInvitation(secondToken)).toMatchObject({ id: row.id })
      const outbox = await outboxFor(row.id)
      expect(outbox.map((o) => o.status)).toEqual(['failed', 'queued'])

      // Expire it, then resend with SMTP healthy: fresh expiry, sent.
      await db
        .update(invitation)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(invitation.id, row.id))
      mail.override = undefined
      const resent = await resendInvitation(row.id, f.actor.id)
      const resentToken = latestInviteToken()
      expect(resentToken).not.toBe(secondToken)
      expect(resent.deliveryStatus).toBe('sent')
      expect(resent.lastSentAt).toBeInstanceOf(Date)
      const [sentRow] = await db
        .select({ lastDeliveryError: invitation.lastDeliveryError })
        .from(invitation)
        .where(eq(invitation.id, row.id))
      expect(sentRow?.lastDeliveryError).toBeNull()
      expect(resent.expiresAt.getTime()).toBeGreaterThan(
        Date.now() + 6 * 86_400_000,
      )

      const delivered = await mailpitHtml(f.email)
      expect(delivered?.Subject).toContain(f.org.name)
      expect(delivered?.HTML).toContain(`/invite/${resentToken}`)
      expect(delivered?.HTML).toContain('Accept invitation')

      const actions = (
        await db
          .select({ action: auditLog.action, actorId: auditLog.actorId })
          .from(auditLog)
          .where(eq(auditLog.organizationId, f.org.id))
      ).map((r) => `${r.action}:${r.actorId}`)
      expect(actions).toContain(`member.invite:${f.actor.id}`)
      expect(actions).toContain(`invitation.resend:${f.actor.id}`)
    } finally {
      await f.cleanup()
    }
  })

  it('marks the invitation failed after three attempts and keeps its link usable', async () => {
    const f = await fixture()
    try {
      mail.override = { host: 'localhost', port: 1 }
      await expect(
        inviteMember({
          organizationId: f.org.id,
          email: f.email,
          role: 'owner',
          actorId: f.actor.id,
        }),
      ).rejects.toBeInstanceOf(InvitationDeliveryError)
      const [row] = await listInvitations(f.org.id)
      const token = latestInviteToken()
      const [queued] = await outboxFor(row.id)
      expect(queued).toMatchObject({ status: 'queued', attempts: 1 })

      // Attempts 2 and 3 go through sendNow, which ignores the retry time.
      await sendNow(queued.id)
      expect((await listInvitations(f.org.id))[0]?.deliveryStatus).toBe(
        'queued',
      )
      const third = await sendNow(queued.id)
      expect(third.status).toBe('failed')

      const [stored] = await db
        .select()
        .from(invitation)
        .where(eq(invitation.id, row.id))
      expect(stored).toMatchObject({ deliveryStatus: 'failed' })
      expect(stored?.lastDeliveryError).toContain(
        "Couldn't reach localhost on port 1",
      )
      // Still usable: the link has not changed or expired.
      expect(await getInvitation(token)).toMatchObject({ id: row.id })
      expect(
        (await outboxFor(row.id)).map((o) => [o.status, o.attempts]),
      ).toEqual([['failed', 3]])
    } finally {
      await f.cleanup()
    }
  })

  it('revokes an undelivered invitation and refuses resending an accepted one', async () => {
    const f = await fixture()
    try {
      mail.override = { host: 'localhost', port: 1 }
      await expect(
        inviteMember({
          organizationId: f.org.id,
          email: f.email,
          role: 'owner',
          actorId: f.actor.id,
        }),
      ).rejects.toBeInstanceOf(InvitationDeliveryError)
      const [row] = await listInvitations(f.org.id)
      const token = latestInviteToken()
      await revokeInvitation(row.id, f.actor.id)
      expect(await listInvitations(f.org.id)).toHaveLength(0)
      expect(await getInvitation(token)).toBeNull()
      await expect(resendInvitation(row.id, f.actor.id)).rejects.toBeInstanceOf(
        NotFoundError,
      )

      mail.override = undefined
      const ok = await inviteMember({
        organizationId: f.org.id,
        email: f.email,
        role: 'editor',
        actorId: f.actor.id,
      })
      expect(ok.deliveryStatus).toBe('sent')
      await db
        .update(invitation)
        .set({ acceptedAt: new Date() })
        .where(eq(invitation.id, ok.id))
      await expect(resendInvitation(ok.id, f.actor.id)).rejects.toBeInstanceOf(
        ConflictError,
      )
    } finally {
      await f.cleanup()
    }
  })

  it('redacts SMTP errors that echo credentials and invitation bearer links', async () => {
    const f = await fixture()
    const lines: string[] = []
    const previousLevel = process.env.LOG_LEVEL
    const restore = setLogSink((_level, line) => lines.push(line))
    process.env.LOG_LEVEL = 'warn'
    try {
      mail.override = {
        host: 'localhost',
        port: 1,
        password: 'smtp-test-secret',
      }
      mail.echoFailure = true
      await expect(
        inviteMember({
          organizationId: f.org.id,
          email: f.email,
          role: 'editor',
          actorId: f.actor.id,
        }),
      ).rejects.toBeInstanceOf(InvitationDeliveryError)
      const [row] = await db
        .select()
        .from(invitation)
        .where(eq(invitation.organizationId, f.org.id))
      expect(row).toBeTruthy()
      const token = latestInviteToken()
      expect(row.lastDeliveryError).not.toContain('smtp-test-secret')
      expect(row.lastDeliveryError).not.toContain(token)
      expect(row.lastDeliveryError!.length).toBeLessThanOrEqual(500)

      const mailLines = lines.filter((line) =>
        line.includes('mail send failed'),
      )
      expect(mailLines).toHaveLength(1)
      expect(mailLines[0]).not.toContain(token)
      expect(mailLines[0]).not.toContain('smtp-test-secret')
      expect(mailLines[0]).toContain('[redacted]')
    } finally {
      restore()
      process.env.LOG_LEVEL = previousLevel
      await f.cleanup()
    }
  })

  it('only accepts a recovered link for its intended email address', async () => {
    const f = await fixture()
    let guestId: string | undefined
    try {
      const initial = await inviteMember({
        organizationId: f.org.id,
        email: f.email,
        role: 'editor',
        actorId: f.actor.id,
      })
      const initialToken = latestInviteToken()
      await resendInvitation(initial.id, f.actor.id)
      const resentToken = latestInviteToken()
      await expect(
        acceptInvitation({ token: initialToken, userId: f.actor.id }),
      ).rejects.toBeInstanceOf(NotFoundError)
      await expect(
        acceptInvitation({ token: resentToken, userId: f.actor.id }),
      ).rejects.toBeInstanceOf(ConflictError)
      expect(await getInvitation(resentToken)).toBeTruthy()
      const [guest] = await db
        .insert(user)
        .values({
          id: crypto.randomUUID(),
          name: 'Guest',
          email: f.email,
          emailVerified: true,
        })
        .returning()
      guestId = guest.id
      await expect(
        acceptInvitation({ token: resentToken, userId: guestId }),
      ).resolves.toEqual({ organizationId: f.org.id, role: 'editor' })
      expect(await getInvitation(resentToken)).toBeNull()
      await expect(
        resendInvitation(initial.id, f.actor.id),
      ).rejects.toBeInstanceOf(ConflictError)
    } finally {
      await f.cleanup()
      if (guestId) await db.delete(user).where(eq(user.id, guestId))
    }
  })
})

describe.skipIf(!hasDb)('invitation links at rest', () => {
  it('stores only the hash, and keeps the raw link out of the outbox and listings', async () => {
    const f = await fixture()
    try {
      mail.override = { host: 'localhost', port: 1 }
      await expect(
        inviteMember({
          organizationId: f.org.id,
          email: f.email,
          role: 'editor',
          actorId: f.actor.id,
        }),
      ).rejects.toBeInstanceOf(InvitationDeliveryError)
      const token = latestInviteToken()

      const [stored] = await db
        .select()
        .from(invitation)
        .where(eq(invitation.organizationId, f.org.id))
      expect(stored?.tokenHash).toBe(
        createHash('sha256').update(token).digest('hex'),
      )
      expect(JSON.stringify(stored)).not.toContain(token)

      const [listed] = await listInvitations(f.org.id)
      expect(listed).not.toHaveProperty('token')
      expect(listed).not.toHaveProperty('tokenHash')
      expect(JSON.stringify(listed)).not.toContain(token)

      const [queued] = await outboxFor(stored.id)
      expect(JSON.stringify(queued)).not.toContain(token)
      expect(queued?.params).not.toHaveProperty('token')
      expect(queued?.params.encryptedToken).toEqual(expect.any(String))
    } finally {
      await f.cleanup()
    }
  })

  it('without a secrets key the outbox holds no link, so a failed send cannot be retried', async () => {
    const f = await fixture()
    try {
      secrets.key = null
      mail.override = { host: 'localhost', port: 1 }
      await expect(
        inviteMember({
          organizationId: f.org.id,
          email: f.email,
          role: 'editor',
          actorId: f.actor.id,
        }),
      ).rejects.toBeInstanceOf(InvitationDeliveryError)
      const token = latestInviteToken()
      const [row] = await listInvitations(f.org.id)
      const [queued] = await outboxFor(row.id)
      expect(queued?.params).not.toHaveProperty('encryptedToken')
      expect(JSON.stringify(queued)).not.toContain(token)

      // The worker has only the stored params, so it cannot rebuild the link.
      expect((await sendNow(queued.id)).status).toBe('failed')
    } finally {
      await f.cleanup()
    }
  })

  it('regenerate link returns the new link once, and the old one stops working', async () => {
    const f = await fixture()
    try {
      mail.override = { host: 'localhost', port: 1 }
      await expect(
        inviteMember({
          organizationId: f.org.id,
          email: f.email,
          role: 'editor',
          actorId: f.actor.id,
        }),
      ).rejects.toBeInstanceOf(InvitationDeliveryError)
      const [row] = await listInvitations(f.org.id)
      const oldToken = latestInviteToken()

      // The email cannot go out, but the admin still gets the link to share.
      const regenerated = await regenerateInvitationLink(row.id, f.actor.id)
      const newToken = regenerated.link.slice(
        regenerated.link.lastIndexOf('/') + 1,
      )
      expect(newToken).toMatch(/^[0-9a-f]{64}$/)
      expect(newToken).not.toBe(oldToken)
      expect(regenerated.emailSent).toBe(false)
      expect(regenerated.emailError).toContain(
        "Couldn't reach localhost on port 1",
      )
      expect(await getInvitation(oldToken)).toBeNull()
      expect(await getInvitation(newToken)).toMatchObject({ id: row.id })
      expect(latestInviteToken()).toBe(newToken)
    } finally {
      await f.cleanup()
    }
  })

  it('regenerate link emails the new link and audits it', async () => {
    const f = await fixture()
    try {
      mail.override = undefined
      const ok = await inviteMember({
        organizationId: f.org.id,
        email: f.email,
        role: 'editor',
        actorId: f.actor.id,
      })
      const oldToken = latestInviteToken()

      const regenerated = await regenerateInvitationLink(ok.id, f.actor.id)
      const newToken = latestInviteToken()
      expect(regenerated.emailSent).toBe(true)
      expect(regenerated.link).toBe(`${process.env.APP_URL}/invite/${newToken}`)
      expect(newToken).not.toBe(oldToken)
      expect(await getInvitation(oldToken)).toBeNull()

      const actions = (
        await db
          .select({ action: auditLog.action, actorId: auditLog.actorId })
          .from(auditLog)
          .where(eq(auditLog.organizationId, f.org.id))
      ).map((r) => `${r.action}:${r.actorId}`)
      expect(actions).toContain(`invitation.regenerate_link:${f.actor.id}`)
    } finally {
      await f.cleanup()
    }
  })
})
