import { eq, sql } from 'drizzle-orm'

import { db } from '#/db'
import { membership, organization, site } from '#/db/schema'
import { audit } from '#/server/audit'
import { ConflictError, NotFoundError } from '#/server/content/errors'

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
    throw new ConflictError('Slug already exists')
  }

  const [created] = await db
    .insert(organization)
    .values({ name: input.name, slug: input.slug })
    .returning()
  if (!created) {
    throw new Error('Failed to create organization')
  }

  await audit({
    organizationId: created.id,
    actorId: input.actorId,
    action: 'organization.create',
    targetType: 'organization',
    targetId: created.id,
    meta: { slug: created.slug },
  })

  return created
}

export async function updateOrganization(id: string, input: { name: string }) {
  const existing = await getOrganization(id)
  if (!existing) {
    throw new NotFoundError('Organization not found')
  }

  const [updated] = await db
    .update(organization)
    .set({ name: input.name, updatedAt: new Date() })
    .where(eq(organization.id, id))
    .returning()
  if (!updated) {
    throw new NotFoundError('Organization not found')
  }

  await audit({
    organizationId: id,
    action: 'organization.update',
    targetType: 'organization',
    targetId: id,
  })

  return updated
}

export async function deleteOrganization(id: string) {
  const existing = await getOrganization(id)
  if (!existing) {
    throw new NotFoundError('Organization not found')
  }

  const [siteRow] = await db
    .select({ id: site.id })
    .from(site)
    .where(eq(site.organizationId, id))
    .limit(1)
  if (siteRow) {
    throw new ConflictError('Cannot delete an organization that has sites')
  }

  await db.delete(organization).where(eq(organization.id, id))
}
