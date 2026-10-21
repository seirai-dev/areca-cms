import type * as MailConfig from '#/server/mail/config'
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
  resendInvitation,
  revokeInvitation,
} from './members.ts'

// `override` undefined: the real environment (Mailpit). null: no mail
// configured. An object: that host and port, with an optional password.
const mail = vi.hoisted(() => ({
  override: undefined as
    undefined | null | { host: string; port: number; password?: string },
  echoFailure: false,
}))

vi.mock('#/server/mail/config', async (importOriginal) => {
  const actual = await importOriginal<typeof MailConfig>()
  return {
    ...actual,
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
})

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
    const res = await fetch(`${base}/api/v1/messages`)
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
      const [afterFailedResend] = await db
        .select()
        .from(invitation)
        .where(eq(invitation.id, row.id))
      expect(afterFailedResend?.token).not.toBe(row.token)
      expect(afterFailedResend?.deliveryStatus).toBe('queued')
      expect(await getInvitation(row.token)).toBeNull()
      const outbox = await outboxFor(row.id)
      expect(outbox.map((o) => o.status)).toEqual(['failed', 'queued'])

      // Expire it, then resend with SMTP healthy: fresh expiry, sent.
      await db
        .update(invitation)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(invitation.id, row.id))
      mail.override = undefined
      const resent = await resendInvitation(row.id, f.actor.id)
      expect(resent.deliveryStatus).toBe('sent')
      expect(resent.lastDeliveryError).toBeNull()
      expect(resent.lastSentAt).toBeInstanceOf(Date)
      expect(resent.token).not.toBe(afterFailedResend?.token)
      expect(resent.expiresAt.getTime()).toBeGreaterThan(
        Date.now() + 6 * 86_400_000,
      )

      const delivered = await mailpitHtml(f.email)
      expect(delivered?.Subject).toContain(f.org.name)
      expect(delivered?.HTML).toContain(`/invite/${resent.token}`)
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

  it('marks the invitation failed after three attempts and keeps its copy-link token', async () => {
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
      // Still usable: the copy-link token has not changed or expired.
      expect(await getInvitation(row.token)).toMatchObject({
        id: row.id,
        token: row.token,
      })
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
      await revokeInvitation(row.id, f.actor.id)
      expect(await listInvitations(f.org.id)).toHaveLength(0)
      expect(await getInvitation(row.token)).toBeNull()
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
      expect(row.lastDeliveryError).not.toContain('smtp-test-secret')
      expect(row.lastDeliveryError).not.toContain(row.token)
      expect(row.lastDeliveryError!.length).toBeLessThanOrEqual(500)

      const mailLines = lines.filter((line) =>
        line.includes('mail send failed'),
      )
      expect(mailLines).toHaveLength(1)
      expect(mailLines[0]).not.toContain(row.token)
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
      const resent = await resendInvitation(initial.id, f.actor.id)
      await expect(
        acceptInvitation({ token: initial.token, userId: f.actor.id }),
      ).rejects.toBeInstanceOf(NotFoundError)
      await expect(
        acceptInvitation({ token: resent.token, userId: f.actor.id }),
      ).rejects.toBeInstanceOf(ConflictError)
      expect(await getInvitation(resent.token)).toBeTruthy()
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
        acceptInvitation({ token: resent.token, userId: guestId }),
      ).resolves.toEqual({ organizationId: f.org.id, role: 'editor' })
      expect(await getInvitation(resent.token)).toBeNull()
      await expect(
        resendInvitation(initial.id, f.actor.id),
      ).rejects.toBeInstanceOf(ConflictError)
    } finally {
      await f.cleanup()
      if (guestId) await db.delete(user).where(eq(user.id, guestId))
    }
  })
})
