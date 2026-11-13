import type * as MailConfig from '#/server/mail/config'

import { and, eq, inArray } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { db } from '#/db'
import {
  emailOutbox,
  invitation,
  membership,
  organization,
  user,
} from '#/db/schema'
import { MailConfigError } from '#/server/mail/errors'
import { hashToken } from '#/server/security/token-hash'

import {
  acceptInvitation,
  regenerateInvitationLink,
  resendInvitation,
} from './invitations.ts'
import { removeMember, updateMemberRole } from './members.ts'

// `unreadable` makes the delivery-time config read fail like a wrong key would.
const mail = vi.hoisted(() => ({ unreadable: false }))

vi.mock('#/server/mail/config', async (importOriginal) => {
  const actual = await importOriginal<typeof MailConfig>()
  return {
    ...actual,
    resolveMailConfig: async () => {
      if (mail.unreadable) throw new MailConfigError('password_unreadable')
      return actual.resolveMailConfig()
    },
  }
})

const hasDb = Boolean(process.env.DATABASE_URL)

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.()
})

/** An organization with an owner (the actor) and one editor (the member). */
async function fixture() {
  const suffix = crypto.randomUUID()
  const org = (
    await db
      .insert(organization)
      .values({ name: `Harbour ${suffix}`, slug: `harbour-${suffix}` })
      .returning()
  ).at(0)
  const owner = (
    await db
      .insert(user)
      .values({
        id: crypto.randomUUID(),
        name: 'Owen Owner',
        email: `owner-${suffix}@areca.local`,
        emailVerified: true,
        locale: 'en',
      })
      .returning()
  ).at(0)
  const member = (
    await db
      .insert(user)
      .values({
        id: crypto.randomUUID(),
        name: 'Edith Editor',
        email: `editor-${suffix}@areca.local`,
        emailVerified: false,
        locale: 'nl',
      })
      .returning()
  ).at(0)
  if (!org || !owner || !member) throw new Error('fixture failed')
  await db.insert(membership).values([
    { userId: owner.id, organizationId: org.id, role: 'owner' },
    { userId: member.id, organizationId: org.id, role: 'editor' },
  ])
  cleanups.push(async () => {
    await db.delete(organization).where(eq(organization.id, org.id))
    await db
      .delete(emailOutbox)
      .where(inArray(emailOutbox.userId, [owner.id, member.id]))
    await db.delete(user).where(inArray(user.id, [owner.id, member.id]))
  })
  return { org, owner, member }
}

async function outboxFor(userId: string, kind: string) {
  return db
    .select()
    .from(emailOutbox)
    .where(and(eq(emailOutbox.userId, userId), eq(emailOutbox.kind, kind)))
}

describe.skipIf(!hasDb)('member account emails', () => {
  it('tells a removed member who removed them and from where', async () => {
    const { org, owner, member } = await fixture()

    await removeMember(org.id, member.id, owner.id)

    const row = (await outboxFor(member.id, 'membership_removed')).at(0)
    expect(row).toMatchObject({ status: 'queued', locale: 'nl' })
    expect(row?.params).toEqual({
      userId: member.id,
      orgName: org.name,
      actorName: 'Owen Owner',
    })
  })

  it('removes the member and queues the notice even when the SMTP password cannot be decrypted', async () => {
    const { org, owner, member } = await fixture()
    mail.unreadable = true
    try {
      await removeMember(org.id, member.id, owner.id)
    } finally {
      mail.unreadable = false
    }

    const [membershipRow] = await db
      .select({ id: membership.id })
      .from(membership)
      .where(
        and(
          eq(membership.userId, member.id),
          eq(membership.organizationId, org.id),
        ),
      )
    expect(membershipRow).toBeUndefined()
    const [row] = await outboxFor(member.id, 'membership_removed')
    expect(row).toMatchObject({ status: 'queued' })
  })

  it('sends nothing when someone leaves on their own', async () => {
    const { org, member } = await fixture()

    await removeMember(org.id, member.id, member.id)

    expect(await outboxFor(member.id, 'membership_removed')).toHaveLength(0)
  })

  it('tells a member about a role change, but only when it changed', async () => {
    const { org, owner, member } = await fixture()

    await updateMemberRole(org.id, member.id, 'editor', owner.id)
    expect(await outboxFor(member.id, 'membership_role_changed')).toHaveLength(
      0,
    )

    await updateMemberRole(org.id, member.id, 'owner', owner.id)
    const row = (await outboxFor(member.id, 'membership_role_changed')).at(0)
    expect(row?.params).toEqual({
      userId: member.id,
      organizationId: org.id,
      role: 'owner',
      previousRole: 'editor',
    })
  })

  it('sends nothing when someone changes their own role', async () => {
    const { org, owner, member } = await fixture()
    // A second owner, so the first may step down.
    await updateMemberRole(org.id, member.id, 'owner', owner.id)

    await updateMemberRole(org.id, owner.id, 'editor', owner.id)

    expect(await outboxFor(owner.id, 'membership_role_changed')).toHaveLength(0)
  })

  it('verifies the address when the invitation email was delivered', async () => {
    const { org } = await fixture()
    const suffix = crypto.randomUUID()
    const invitee = await db
      .insert(user)
      .values({
        id: crypto.randomUUID(),
        name: 'New Person',
        email: `invitee-${suffix}@areca.local`,
        emailVerified: false,
      })
      .returning()
    const person = invitee.at(0)
    if (!person) throw new Error('fixture failed')
    cleanups.push(async () => {
      await db.delete(user).where(eq(user.id, person.id))
    })
    const token = `tok-${suffix}`
    await db.insert(invitation).values({
      email: person.email,
      organizationId: org.id,
      role: 'editor',
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + 60_000),
      deliveryStatus: 'sent',
    })

    await acceptInvitation({ token, userId: person.id })

    const after = (
      await db
        .select({ emailVerified: user.emailVerified })
        .from(user)
        .where(eq(user.id, person.id))
    ).at(0)
    expect(after?.emailVerified).toBe(true)
  })

  it('leaves the address unverified when the invitation email never arrived', async () => {
    const { org } = await fixture()
    const suffix = crypto.randomUUID()
    const invitee = await db
      .insert(user)
      .values({
        id: crypto.randomUUID(),
        name: 'Unreached Person',
        email: `unreached-${suffix}@areca.local`,
        emailVerified: false,
      })
      .returning()
    const person = invitee.at(0)
    if (!person) throw new Error('fixture failed')
    cleanups.push(async () => {
      await db.delete(user).where(eq(user.id, person.id))
    })
    const token = `tok-${suffix}`
    await db.insert(invitation).values({
      email: person.email,
      organizationId: org.id,
      role: 'editor',
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + 60_000),
      deliveryStatus: 'failed',
    })

    await acceptInvitation({ token, userId: person.id })

    const after = (
      await db
        .select({ emailVerified: user.emailVerified })
        .from(user)
        .where(eq(user.id, person.id))
    ).at(0)
    expect(after?.emailVerified).toBe(false)
  })
  /** An unverified person with a delivered invitation, and its raw token. */
  async function deliveredInvite(linkRevealedAt: Date | null) {
    const { org, owner } = await fixture()
    const suffix = crypto.randomUUID()
    const person = (
      await db
        .insert(user)
        .values({
          id: crypto.randomUUID(),
          name: 'Linked Person',
          email: `linked-${suffix}@areca.local`,
          emailVerified: false,
        })
        .returning()
    ).at(0)
    if (!person) throw new Error('fixture failed')
    cleanups.push(async () => {
      await db.delete(user).where(eq(user.id, person.id))
    })
    const token = `tok-${suffix}`
    const row = (
      await db
        .insert(invitation)
        .values({
          email: person.email,
          organizationId: org.id,
          role: 'editor',
          tokenHash: hashToken(token),
          expiresAt: new Date(Date.now() + 60_000),
          deliveryStatus: 'sent',
          linkRevealedAt,
        })
        .returning()
    ).at(0)
    if (!row) throw new Error('fixture failed')
    return { person, token, invitationId: row.id, owner }
  }

  async function emailVerifiedOf(userId: string) {
    const after = (
      await db
        .select({ emailVerified: user.emailVerified })
        .from(user)
        .where(eq(user.id, userId))
    ).at(0)
    return after?.emailVerified
  }

  it('leaves the address unverified when the inviter was shown the link', async () => {
    const { person, token } = await deliveredInvite(new Date())

    await acceptInvitation({ token, userId: person.id })

    expect(await emailVerifiedOf(person.id)).toBe(false)
  })

  it('records that the link was revealed on "Regenerate link", not on resend', async () => {
    const resent = await deliveredInvite(null)
    await resendInvitation(resent.invitationId, resent.owner.id).catch(
      () => undefined,
    )
    const revealed = await deliveredInvite(null)
    const { link } = await regenerateInvitationLink(
      revealed.invitationId,
      revealed.owner.id,
    )

    const rows = await db
      .select({ id: invitation.id, linkRevealedAt: invitation.linkRevealedAt })
      .from(invitation)
      .where(
        inArray(invitation.id, [resent.invitationId, revealed.invitationId]),
      )
    const byId = new Map(rows.map((row) => [row.id, row.linkRevealedAt]))
    expect(byId.get(resent.invitationId)).toBeNull()
    expect(byId.get(revealed.invitationId)).toBeInstanceOf(Date)

    await db
      .update(invitation)
      .set({ deliveryStatus: 'sent' })
      .where(eq(invitation.id, revealed.invitationId))
    await acceptInvitation({
      token: link.slice(link.lastIndexOf('/') + 1),
      userId: revealed.person.id,
    })
    expect(await emailVerifiedOf(revealed.person.id)).toBe(false)
  })

  it('forgets the revealed link when a resend replaces it', async () => {
    const { invitationId, owner } = await deliveredInvite(new Date())

    await resendInvitation(invitationId, owner.id).catch(() => undefined)

    const [row] = await db
      .select({ linkRevealedAt: invitation.linkRevealedAt })
      .from(invitation)
      .where(eq(invitation.id, invitationId))
    expect(row?.linkRevealedAt).toBeNull()
  })
})
