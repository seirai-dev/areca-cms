/* eslint-disable @typescript-eslint/no-unnecessary-condition -- Drizzle row arrays can be empty; retain defensive lookup and authorization checks. */
import { eq, sql } from 'drizzle-orm'

import { db } from '#/db'
import {
  asset,
  membership,
  organization,
  site,
  storageObjectDeletion,
} from '#/db/schema'
import { m } from '#/paraglide/messages'
import { assetExclusiveLock } from '#/server/assets/usage'
import { drainStorageObjectDeletions } from '#/server/assets'
import { derivedStorageKeys } from '#/server/assets/derived'
import { audit } from '#/server/audit'
import { ConflictError, NotFoundError } from '#/server/content/errors'
import { lockOrganizationForMutation } from './organization-lock'

export async function listOrganizations() {
  const rows = await db
    .select({
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      createdAt: organization.createdAt,
      updatedAt: organization.updatedAt,
      siteCount: sql<number>`cast(count(distinct ${site.id}) as int)`,
      memberCount: sql<number>`cast(count(distinct ${membership.id}) as int)`,
    })
    .from(organization)
    .leftJoin(site, eq(site.organizationId, organization.id))
    .leftJoin(membership, eq(membership.organizationId, organization.id))
    .groupBy(
      organization.id,
      organization.name,
      organization.slug,
      organization.createdAt,
      organization.updatedAt,
    )
    .orderBy(organization.name)

  return rows.map((row) => ({
    ...row,
    siteCount: Number(row.siteCount),
    memberCount: Number(row.memberCount),
  }))
}

export async function getOrganization(id: string) {
  const [row] = await db
    .select()
    .from(organization)
    .where(eq(organization.id, id))
    .limit(1)
  return row ?? null
}

export async function createOrganization(input: {
  name: string
  slug: string
  actorId: string
}) {
  const [existing] = await db
    .select({ id: organization.id })
    .from(organization)
    .where(eq(organization.slug, input.slug))
    .limit(1)
  if (existing) {
    throw new ConflictError(m.server_slug_already_exists())
  }

  return db.transaction(async (tx) => {
    const [created] = await tx
      .insert(organization)
      .values({ name: input.name, slug: input.slug })
      .returning()
    if (!created) {
      throw new Error(m.server_failed_to_create_organization())
    }

    await audit(
      {
        organizationId: created.id,
        actorId: input.actorId,
        action: 'organization.create',
        targetType: 'organization',
        targetId: created.id,
        meta: { slug: created.slug },
      },
      tx,
    )

    return created
  })
}

export async function updateOrganization(
  id: string,
  input: { name: string },
  actorId: string,
) {
  const existing = await getOrganization(id)
  if (!existing) {
    throw new NotFoundError(m.server_organization_not_found())
  }

  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(organization)
      .set({ name: input.name, updatedAt: new Date() })
      .where(eq(organization.id, id))
      .returning()
    if (!updated) {
      throw new NotFoundError(m.server_organization_not_found())
    }

    await audit(
      {
        organizationId: id,
        actorId,
        action: 'organization.update',
        targetType: 'organization',
        targetId: id,
        meta: { name: input.name, previousName: existing.name },
      },
      tx,
    )

    return updated
  })
}

export async function deleteOrganization(id: string, actorId: string) {
  await db.transaction(async (tx) => {
    const existing = await lockOrganizationForMutation(tx, id)
    const [siteRow] = await tx
      .select({ id: site.id })
      .from(site)
      .where(eq(site.organizationId, id))
      .limit(1)
    if (siteRow)
      throw new ConflictError(m.server_cannot_delete_org_with_sites())
    await assetExclusiveLock(tx, id)
    const objects = await tx
      .select({ storageKey: asset.storageKey })
      .from(asset)
      .where(eq(asset.organizationId, id))
    const keys = objects.flatMap(({ storageKey }) => [
      storageKey,
      ...derivedStorageKeys(storageKey),
    ])
    // Chunks stay below PostgreSQL's 65,535 bind-parameter limit.
    for (let i = 0; i < keys.length; i += 5000)
      await tx
        .insert(storageObjectDeletion)
        .values(keys.slice(i, i + 5000).map((storageKey) => ({ storageKey })))
        .onConflictDoNothing()
    await tx.delete(organization).where(eq(organization.id, id))
    // The organization's own audit rows cascade away with it, so the deletion
    // is recorded at instance level.
    await audit(
      {
        organizationId: null,
        actorId,
        action: 'organization.delete',
        targetType: 'organization',
        targetId: id,
        meta: { name: existing.name, slug: existing.slug },
      },
      tx,
    )
  })
  await drainStorageObjectDeletions()
}
