import { eq, inArray } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mail = vi.hoisted(() => ({ fail: false, sent: [] as string[] }))
vi.mock('#/adapters/email', () => ({
  sendEmail: vi.fn(async (opts: { to: string; text: string }) => {
    if (mail.fail)
      throw new Error('connect ECONNREFUSED smtp.internal:25\nstack')
    mail.sent.push(opts.text)
  }),
}))

import { db } from '#/db'
import { auditLog, invitation, organization, user } from '#/db/schema'
import { ConflictError } from '#/server/content/errors'

import {
  InvitationDeliveryError,
  inviteMember,
  listInvitations,
  resendInvitation,
  revokeInvitation,
} from './members.ts'

const hasDb = Boolean(process.env.DATABASE_URL)

beforeEach(() => {
  mail.fail = false
  mail.sent = []
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

describe.skipIf(!hasDb)('invitation delivery failures', () => {
  it('keeps the invitation, marks it failed, and resends with a fresh token', async () => {
    const f = await fixture()
    try {
      mail.fail = true
      await expect(
        inviteMember({
          organizationId: f.org.id,
          email: f.email,
          role: 'editor',
          actorId: f.actor.id,
        }),
      ).rejects.toBeInstanceOf(InvitationDeliveryError)

      const [row] = await listInvitations(f.org.id)
      expect(row).toMatchObject({ email: f.email, deliveryStatus: 'failed' })
      const [stored] = await db
        .select()
        .from(invitation)
        .where(eq(invitation.id, row!.id))
      // First line only, bounded.
      expect(stored?.lastDeliveryError).toBe(
        'connect ECONNREFUSED smtp.internal:25',
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

      // Resend while SMTP is still down: stays failed, token rotates anyway.
      await expect(
        resendInvitation(row!.id, f.actor.id),
      ).rejects.toBeInstanceOf(InvitationDeliveryError)
      const [afterFailedResend] = await db
        .select()
        .from(invitation)
        .where(eq(invitation.id, row!.id))
      expect(afterFailedResend?.token).not.toBe(row!.token)
      expect(afterFailedResend?.deliveryStatus).toBe('failed')

      // Expire it, then resend with SMTP healthy: fresh expiry, sent.
      await db
        .update(invitation)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(invitation.id, row!.id))
      mail.fail = false
      const resent = await resendInvitation(row!.id, f.actor.id)
      expect(resent.deliveryStatus).toBe('sent')
      expect(resent.lastDeliveryError).toBeNull()
      expect(resent.lastSentAt).toBeInstanceOf(Date)
      expect(resent.token).not.toBe(afterFailedResend?.token)
      expect(resent.expiresAt.getTime()).toBeGreaterThan(
        Date.now() + 6 * 86_400_000,
      )
      expect(mail.sent).toHaveLength(1)
      expect(mail.sent[0]).toContain(`/invite/${resent.token}`)

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

  it('revokes an undelivered invitation and refuses resending an accepted one', async () => {
    const f = await fixture()
    try {
      mail.fail = true
      await expect(
        inviteMember({
          organizationId: f.org.id,
          email: f.email,
          role: 'owner',
          actorId: f.actor.id,
        }),
      ).rejects.toBeInstanceOf(InvitationDeliveryError)
      const [row] = await listInvitations(f.org.id)
      await revokeInvitation(row!.id, f.actor.id)
      expect(await listInvitations(f.org.id)).toHaveLength(0)

      mail.fail = false
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
})
