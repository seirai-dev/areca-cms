import { randomBytes } from 'node:crypto'
import { eq, inArray } from 'drizzle-orm'
import type { InferSelectModel } from 'drizzle-orm'
import { z } from 'zod'

import { db } from '#/db'
import {
  buildJob,
  collection,
  entry,
  entryRevision,
  organization,
  publication,
  site,
} from '#/db/schema'
import type { DeploymentTarget } from '#/lib/types'
import { m } from '#/paraglide/messages'
import { audit } from '#/server/audit'
import { ConflictError, NotFoundError } from '#/server/content/errors'
import { generateSiteToken } from '#/server/content/site-auth'

export const deploymentTargetSchema: z.ZodType<DeploymentTarget | null> =
  z.union([
    z.object({
      provider: z.literal('dokploy'),
      applicationId: z.string().min(1),
      healthCheckUrl: z.string().url().optional(),
    }),
    z.null(),
  ])

export type PublicSite = Omit<
  InferSelectModel<typeof site>,
  'tokenHash' | 'previewSecret'
>

const publicSiteColumns = {
  id: site.id,
  organizationId: site.organizationId,
  name: site.name,
  slug: site.slug,
  productionUrl: site.productionUrl,
  deploymentTarget: site.deploymentTarget,
  lastManifest: site.lastManifest,
  createdAt: site.createdAt,
  updatedAt: site.updatedAt,
}

function toPublicSite(row: InferSelectModel<typeof site>): PublicSite {
  const { tokenHash: _tokenHash, previewSecret: _previewSecret, ...rest } = row
  return rest
}

export async function listSites(organizationId?: string) {
  const rows = organizationId
    ? await db
        .select(publicSiteColumns)
        .from(site)
        .where(eq(site.organizationId, organizationId))
        .orderBy(site.name)
    : await db.select(publicSiteColumns).from(site).orderBy(site.name)
  return rows
}

export async function getSite(id: string): Promise<PublicSite | null> {
  const [row] = await db
    .select(publicSiteColumns)
    .from(site)
    .where(eq(site.id, id))
    .limit(1)
  return row ?? null
}

export async function createSite(input: {
  organizationId: string
  name: string
  slug: string
  productionUrl: string
  actorId: string
}) {
  const [org] = await db
    .select({ id: organization.id })
    .from(organization)
    .where(eq(organization.id, input.organizationId))
    .limit(1)
  if (!org) {
    throw new NotFoundError(m.server_organization_not_found())
  }

  const [slugTaken] = await db
    .select({ id: site.id })
    .from(site)
    .where(eq(site.slug, input.slug))
    .limit(1)
  if (slugTaken) {
    throw new ConflictError(m.server_slug_already_exists())
  }

  const { token, hash } = generateSiteToken()
  const previewSecret = randomBytes(32).toString('hex')

  const [created] = await db
    .insert(site)
    .values({
      organizationId: input.organizationId,
      name: input.name,
      slug: input.slug,
      tokenHash: hash,
      productionUrl: input.productionUrl,
      previewSecret,
    })
    .returning()
  if (!created) {
    throw new Error(m.server_failed_to_create_site())
  }

  await audit({
    organizationId: input.organizationId,
    siteId: created.id,
    actorId: input.actorId,
    action: 'site.create',
    targetType: 'site',
    targetId: created.id,
    meta: { slug: created.slug },
  })

  return { ...toPublicSite(created), token, previewSecret }
}

export async function updateSite(
  id: string,
  input: {
    name?: string
    productionUrl?: string
    deploymentTarget?: DeploymentTarget | null
  },
) {
  const [existing] = await db
    .select()
    .from(site)
    .where(eq(site.id, id))
    .limit(1)
  if (!existing) {
    throw new NotFoundError(m.server_site_not_found())
  }

  const patch: {
    name?: string
    productionUrl?: string
    deploymentTarget?: DeploymentTarget | null
    updatedAt: Date
  } = { updatedAt: new Date() }

  if (input.name !== undefined) patch.name = input.name
  if (input.productionUrl !== undefined)
    patch.productionUrl = input.productionUrl
  if ('deploymentTarget' in input) {
    patch.deploymentTarget = deploymentTargetSchema.parse(
      input.deploymentTarget,
    )
  }

  const [updated] = await db
    .update(site)
    .set(patch)
    .where(eq(site.id, id))
    .returning()
  if (!updated) {
    throw new NotFoundError(m.server_site_not_found())
  }

  await audit({
    organizationId: existing.organizationId,
    siteId: id,
    action: 'site.update',
    targetType: 'site',
    targetId: id,
  })

  return toPublicSite(updated)
}

export async function rotateSiteTokenAdmin(id: string) {
  const [existing] = await db
    .select()
    .from(site)
    .where(eq(site.id, id))
    .limit(1)
  if (!existing) {
    throw new NotFoundError(m.server_site_not_found())
  }

  const generated = generateSiteToken()
  await db
    .update(site)
    .set({ tokenHash: generated.hash, updatedAt: new Date() })
    .where(eq(site.id, id))

  await audit({
    organizationId: existing.organizationId,
    siteId: id,
    action: 'site.rotate_token',
    targetType: 'site',
    targetId: id,
  })

  return { token: generated.token }
}

export async function deleteSite(id: string) {
  const [existing] = await db
    .select()
    .from(site)
    .where(eq(site.id, id))
    .limit(1)
  if (!existing) {
    throw new NotFoundError(m.server_site_not_found())
  }

  await db.transaction(async (tx) => {
    const entryRows = await tx
      .select({ id: entry.id })
      .from(entry)
      .where(eq(entry.siteId, id))
    const entryIds = entryRows.map((row) => row.id)
    if (entryIds.length > 0) {
      await tx
        .delete(entryRevision)
        .where(inArray(entryRevision.entryId, entryIds))
    }
    await tx.delete(entry).where(eq(entry.siteId, id))
    await tx.delete(collection).where(eq(collection.siteId, id))
    await tx.delete(buildJob).where(eq(buildJob.siteId, id))
    await tx.delete(publication).where(eq(publication.siteId, id))
    await tx.delete(site).where(eq(site.id, id))
  })

  await audit({
    organizationId: existing.organizationId,
    actorId: null,
    action: 'site.delete',
    targetType: 'site',
    targetId: id,
  })
}
