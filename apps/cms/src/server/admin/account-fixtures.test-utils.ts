/**
 * Seeds for the person-level DB tests (blocking, deletion, client access).
 * People are created per test with unique emails and removed afterwards.
 */
import { inArray, isNull, and, eq } from 'drizzle-orm'

import { db } from '#/db'
import type { Tx } from '#/db'
import { membership, organization, user } from '#/db/schema'
import { createTestSite } from '#/server/content/test-utils'

export { createTestSite }

export async function makePerson(
  input: {
    name?: string
    admin?: boolean
    twoFactor?: boolean
    locale?: 'en' | 'nl' | 'tr' | null
  } = {},
) {
  const id = crypto.randomUUID()
  const row = (
    await db
      .insert(user)
      .values({
        id,
        name: input.name ?? `Person ${id.slice(0, 6)}`,
        email: `person-${id}@areca.test`,
        emailVerified: true,
        isAgencyAdmin: input.admin ?? false,
        twoFactorEnabled: input.twoFactor ?? false,
        locale: input.locale === undefined ? 'en' : input.locale,
      })
      .returning()
  ).at(0)
  if (!row) throw new Error('Failed to create person')
  return row
}

export async function makeClient(label = 'Client') {
  const suffix = crypto.randomUUID()
  const row = (
    await db
      .insert(organization)
      .values({ name: label, slug: `client-${suffix}` })
      .returning()
  ).at(0)
  if (!row) throw new Error('Failed to create client')
  return row
}

export async function join(
  userId: string,
  organizationId: string,
  role: 'owner' | 'editor',
) {
  await db.insert(membership).values({ userId, organizationId, role })
}

/**
 * The active-admin count, limited to the admins a suite created. The shared
 * test database holds agency admins from other suites, and they come and go
 * while a suite runs, so suites that test the last-admin rule mock the count
 * with this. The locking and the row locks stay real; only the set counted
 * is narrowed to the fixture admins.
 */
export async function scopedActiveAdminCount(tx: Tx, ids: string[]) {
  const rows = await tx
    .select({ id: user.id })
    .from(user)
    .where(
      and(
        eq(user.isAgencyAdmin, true),
        isNull(user.blockedAt),
        inArray(user.id, ids),
      ),
    )
  return rows.length
}

export async function removePeople(ids: string[]) {
  if (ids.length === 0) return
  await db.delete(user).where(inArray(user.id, ids))
}

export async function removeClients(ids: string[]) {
  if (ids.length === 0) return
  await db.delete(organization).where(inArray(organization.id, ids))
}
