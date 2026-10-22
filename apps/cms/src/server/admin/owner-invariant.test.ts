import { eq, inArray } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { db } from '#/db'
import { membership, organization, user } from '#/db/schema'
import { ConflictError } from '#/server/content/errors'

import { removeMember, updateMemberRole } from './members.ts'

const hasDb = Boolean(process.env.DATABASE_URL)

async function setup(suffix: string) {
  const org = (await db
    .insert(organization)
    .values({ name: `Owners ${suffix}`, slug: `owners-${suffix}` })
    .returning()).at(0)
  const users = await db
    .insert(user)
    .values(
      ['a', 'b'].map((tag) => ({
        id: crypto.randomUUID(),
        name: `Owner ${tag}`,
        email: `owner-${tag}-${suffix}@test.local`,
        emailVerified: true,
      })),
    )
    .returning()
  if (!org || users.length !== 2) throw new Error('setup failed')
  await db.insert(membership).values(
    users.map((u) => ({
      userId: u.id,
      organizationId: org.id,
      role: 'owner' as const,
    })),
  )
  return { org, users }
}

describe.skipIf(!hasDb)('last-owner invariant under concurrency', () => {
  it('keeps one owner when two owners demote each other at once', async () => {
    for (let round = 0; round < 8; round++) {
      const suffix = crypto.randomUUID()
      const { org, users } = await setup(suffix)
      const [a, b] = users as [(typeof users)[0], (typeof users)[0]]
      try {
        const results = await Promise.allSettled([
          updateMemberRole(org.id, a.id, 'editor', b.id),
          updateMemberRole(org.id, b.id, 'editor', a.id),
        ])
        expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
        const rejected = results.find((r) => r.status === 'rejected')
        expect(
          rejected?.status === 'rejected' && rejected.reason,
        ).toBeInstanceOf(ConflictError)
        const rows = await db
          .select({ role: membership.role })
          .from(membership)
          .where(eq(membership.organizationId, org.id))
        expect(rows.filter((r) => r.role === 'owner')).toHaveLength(1)
      } finally {
        await db.delete(organization).where(eq(organization.id, org.id))
        await db.delete(user).where(
          inArray(
            user.id,
            users.map((u) => u.id),
          ),
        )
      }
    }
  })

  it('keeps one owner when a demotion races a removal', async () => {
    for (let round = 0; round < 8; round++) {
      const suffix = crypto.randomUUID()
      const { org, users } = await setup(suffix)
      const [a, b] = users as [(typeof users)[0], (typeof users)[0]]
      try {
        const results = await Promise.allSettled([
          updateMemberRole(org.id, a.id, 'editor', b.id),
          removeMember(org.id, b.id, a.id),
        ])
        expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
        const rejected = results.find((r) => r.status === 'rejected')
        expect(
          rejected?.status === 'rejected' && rejected.reason,
        ).toBeInstanceOf(ConflictError)
        const rows = await db
          .select({ role: membership.role })
          .from(membership)
          .where(eq(membership.organizationId, org.id))
        expect(rows.filter((r) => r.role === 'owner')).toHaveLength(1)
      } finally {
        await db.delete(organization).where(eq(organization.id, org.id))
        await db.delete(user).where(
          inArray(
            user.id,
            users.map((u) => u.id),
          ),
        )
      }
    }
  })
})
