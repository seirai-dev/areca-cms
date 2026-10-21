/* eslint-disable @typescript-eslint/no-unnecessary-condition -- Drizzle row arrays can be empty at runtime, so lookups stay defensive. */
/**
 * Seeds for notification DB tests. Users, organizations and sites are created
 * per test and removed with their owners, so parallel test files never share
 * a notification recipient.
 */
import { randomBytes } from 'node:crypto'

import { eq } from 'drizzle-orm'

import { db } from '#/db'
import { membership, publication, user } from '#/db/schema'
import type {
  MembershipRole,
  PublicationStatus,
  Snapshot,
  SnapshotEntry,
} from '#/lib/types'
import { createTestSite } from '#/server/content/test-utils'

export { createTestSite }

export async function makeUser(
  input: {
    name?: string
    verified?: boolean
    agencyAdmin?: boolean
    locale?: 'en' | 'nl' | 'tr' | null
  } = {},
) {
  const id = crypto.randomUUID()
  const [row] = await db
    .insert(user)
    .values({
      id,
      name: input.name ?? 'Notify Person',
      email: `notify-${id}@test.local`,
      emailVerified: input.verified ?? true,
      isAgencyAdmin: input.agencyAdmin ?? false,
      locale: input.locale ?? null,
    })
    .returning()
  if (!row) throw new Error('Failed to create user')
  return row
}

export async function addMember(
  userId: string,
  organizationId: string,
  role: MembershipRole,
) {
  await db.insert(membership).values({ userId, organizationId, role })
}

export async function removeUsers(ids: string[]) {
  for (const id of ids) {
    await db.delete(user).where(eq(user.id, id))
  }
}

/** Publishes an entry list. `live` marks the release as the site's live one. */
export async function insertPublication(input: {
  siteId: string
  status?: PublicationStatus
  origin?: 'manual' | 'scheduled' | 'rollback'
  requestedBy?: string | null
  scheduledBy?: string[]
  createdAt?: Date
  entries?: { slug: string; title: string; collectionKey?: string }[]
}) {
  const id = crypto.randomUUID()
  const collectionKey = 'blog'
  const entries: SnapshotEntry[] = (input.entries ?? []).map((entry) => ({
    id: crypto.randomUUID(),
    slug: entry.slug,
    publishedAt: null,
    data: { title: entry.title },
  }))
  const snapshot: Snapshot = {
    publicationId: id,
    siteKey: 'test-site',
    createdAt: new Date().toISOString(),
    hash: randomBytes(8).toString('hex'),
    collections: entries.length ? { [collectionKey]: entries } : {},
  }
  const [row] = await db
    .insert(publication)
    .values({
      id,
      siteId: input.siteId,
      snapshot,
      snapshotHash: snapshot.hash,
      entryVersions: [],
      requestedBy: input.requestedBy ?? null,
      status: input.status ?? 'live',
      origin: input.origin ?? 'manual',
      scheduledBy: input.scheduledBy ?? [],
      wasLive: (input.status ?? 'live') === 'live',
      createdAt: input.createdAt ?? new Date(),
    })
    .returning()
  if (!row) throw new Error('Failed to create publication')
  return row
}
