/* eslint-disable @typescript-eslint/no-unnecessary-condition -- Drizzle row arrays can be empty at runtime, so lookups stay defensive. */
import { and, eq, inArray } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'

import { db } from '#/db'
import {
  emailOutbox,
  invitation,
  membership,
  organization,
  user,
} from '#/db/schema'

import { acceptInvitation, removeMember, updateMemberRole } from './members.ts'

const hasDb = Boolean(process.env.DATABASE_URL)

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.()
})

/** An organization with an owner (the actor) and one editor (the member). */
async function fixture() {
  const suffix = crypto.randomUUID()
  const [org] = await db
    .insert(organization)
    .values({ name: `Harbour ${suffix}`, slug: `harbour-${suffix}` })
    .returning()
  const [owner] = await db
    .insert(user)
    .values({
      id: crypto.randomUUID(),
      name: 'Owen Owner',
      email: `owner-${suffix}@areca.local`,
      emailVerified: true,
      locale: 'en',
    })
    .returning()
  const [member] = await db
    .insert(user)
    .values({
      id: crypto.randomUUID(),
      name: 'Edith Editor',
      email: `editor-${suffix}@areca.local`,
      emailVerified: false,
      locale: 'nl',
    })
    .returning()
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

    const [row] = await outboxFor(member.id, 'membership_removed')
    expect(row).toMatchObject({ status: 'queued', locale: 'nl' })
    expect(row?.params).toEqual({
      userId: member.id,
      orgName: org.name,
      actorName: 'Owen Owner',
    })
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
    const [row] = await outboxFor(member.id, 'membership_role_changed')
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
    const person = invitee[0]
    if (!person) throw new Error('fixture failed')
    cleanups.push(async () => {
      await db.delete(user).where(eq(user.id, person.id))
    })
    const token = `tok-${suffix}`
    await db.insert(invitation).values({
      email: person.email,
      organizationId: org.id,
      role: 'editor',
      token,
      expiresAt: new Date(Date.now() + 60_000),
      deliveryStatus: 'sent',
    })

    await acceptInvitation({ token, userId: person.id })

    const [after] = await db
      .select({ emailVerified: user.emailVerified })
      .from(user)
      .where(eq(user.id, person.id))
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
    const person = invitee[0]
    if (!person) throw new Error('fixture failed')
    cleanups.push(async () => {
      await db.delete(user).where(eq(user.id, person.id))
    })
    const token = `tok-${suffix}`
    await db.insert(invitation).values({
      email: person.email,
      organizationId: org.id,
      role: 'editor',
      token,
      expiresAt: new Date(Date.now() + 60_000),
      deliveryStatus: 'failed',
    })

    await acceptInvitation({ token, userId: person.id })

    const [after] = await db
      .select({ emailVerified: user.emailVerified })
      .from(user)
      .where(eq(user.id, person.id))
    expect(after?.emailVerified).toBe(false)
  })
})
