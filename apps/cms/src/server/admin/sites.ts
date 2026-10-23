import { archiveDeletedContent } from '#/server/content/deletion-archive'
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
import { isValidSlug } from '#/lib/slug'
import type { DeploymentTarget } from '#/lib/types'
import { m } from '#/paraglide/messages'
import { audit } from '#/server/audit'
import { lockOrganizationForMutation } from './organization-lock'
import { assertSiteHasNoPendingDeployment } from '#/server/publishing/deployment-safety'
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from '#/server/content/errors'
import { generateSiteToken } from '#/server/content/site-auth'

export const deploymentTargetSchema: z.ZodType<DeploymentTarget | null> =
  z.union([
    z.object({
      provider: z.literal('dokploy'),
      applicationId: z.string().min(1),
      healthCheckUrl: z
        .string()
        .url()
        .refine(
          (value) => ['http:', 'https:'].includes(new URL(value).protocol),
          'Health URL must use HTTP or HTTPS',
        ),
    }),
    z.null(),
  ])

export type PublicSite = Omit<
  InferSelectModel<typeof site>,
  'tokenHash' | 'schemaTokenHash' | 'previewSecret'
>

const publicSiteColumns = {
  id: site.id,
  organizationId: site.organizationId,
  name: site.name,
  slug: site.slug,
  productionUrl: site.productionUrl,
  publishingMode: site.publishingMode,
  deploymentTarget: site.deploymentTarget,
  lastManifest: site.lastManifest,
  aiPrompt: site.aiPrompt,
  languages: site.languages,
  createdAt: site.createdAt,
  updatedAt: site.updatedAt,
}

function toPublicSite(row: InferSelectModel<typeof site>): PublicSite {
  const {
    tokenHash: _tokenHash,
    schemaTokenHash: _schemaTokenHash,
    previewSecret: _previewSecret,
    ...rest
  } = row
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
  const row = (
    await db
      .select(publicSiteColumns)
      .from(site)
      .where(eq(site.id, id))
      .limit(1)
  ).at(0)
  return row ?? null
}

/** The shared slug rule (`#/lib/slug`), as a validation error on `slug`. */
function assertSiteSlug(slug: string) {
  if (!isValidSlug(slug)) {
    throw new ValidationError([
      { path: 'slug', message: m.server_site_slug_invalid() },
    ])
  }
}

function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const { code, cause } = error as { code?: unknown; cause?: unknown }
  return (
    code === '23505' ||
    (typeof cause === 'object' &&
      cause !== null &&
      (cause as { code?: unknown }).code === '23505')
  )
}

export async function createSite(input: {
  organizationId: string
  name: string
  slug: string
  productionUrl: string
  actorId: string
}) {
  const org = (
    await db
      .select({ id: organization.id })
      .from(organization)
      .where(eq(organization.id, input.organizationId))
      .limit(1)
  ).at(0)
  if (!org) {
    throw new NotFoundError(m.server_organization_not_found())
  }
  assertSiteSlug(input.slug)

  const slugTaken = (
    await db
      .select({ id: site.id })
      .from(site)
      .where(eq(site.slug, input.slug))
      .limit(1)
  ).at(0)
  if (slugTaken) {
    throw new ConflictError(m.server_slug_already_exists())
  }

  const { token, hash } = generateSiteToken()
  const schemaToken = generateSiteToken()
  const previewSecret = randomBytes(32).toString('hex')

  const created = await db.transaction(async (tx) => {
    await lockOrganizationForMutation(tx, input.organizationId)
    const row = (
      await tx
        .insert(site)
        .values({
          organizationId: input.organizationId,
          name: input.name,
          slug: input.slug,
          tokenHash: hash,
          schemaTokenHash: schemaToken.hash,
          productionUrl: input.productionUrl,
          previewSecret,
        })
        .returning()
    ).at(0)
    if (!row) {
      throw new Error(m.server_failed_to_create_site())
    }

    await audit(
      {
        organizationId: input.organizationId,
        siteId: row.id,
        actorId: input.actorId,
        action: 'site.create',
        targetType: 'site',
        targetId: row.id,
        meta: { slug: row.slug },
      },
      tx,
    )
    return row
  })

  return {
    ...toPublicSite(created),
    token,
    schemaToken: schemaToken.token,
    previewSecret,
  }
}

export async function updateSite(
  id: string,
  input: {
    name?: string
    productionUrl?: string
    publishingMode?: 'production' | 'demo'
    deploymentTarget?: DeploymentTarget | null
    aiPrompt?: string | null
  },
  actorId: string,
) {
  const existing = (
    await db.select().from(site).where(eq(site.id, id)).limit(1)
  ).at(0)
  if (!existing) {
    throw new NotFoundError(m.server_site_not_found())
  }

  const patch: {
    name?: string
    productionUrl?: string
    publishingMode?: 'production' | 'demo'
    deploymentTarget?: DeploymentTarget | null
    aiPrompt?: string | null
    updatedAt: Date
  } = { updatedAt: new Date() }

  if (input.publishingMode !== undefined)
    patch.publishingMode = z
      .enum(['production', 'demo'])
      .parse(input.publishingMode)
  if (input.name !== undefined) patch.name = input.name
  if (input.productionUrl !== undefined)
    patch.productionUrl = input.productionUrl
  if (input.aiPrompt !== undefined)
    patch.aiPrompt = input.aiPrompt?.trim() ? input.aiPrompt : null
  if ('deploymentTarget' in input) {
    patch.deploymentTarget = deploymentTargetSchema.parse(
      input.deploymentTarget,
    )
  }

  const changed = (Object.keys(patch) as (keyof typeof patch)[]).filter(
    (key) => key !== 'updatedAt',
  )
  const updated = await db.transaction(async (tx) => {
    const row = (
      await tx.update(site).set(patch).where(eq(site.id, id)).returning()
    ).at(0)
    if (!row) {
      throw new NotFoundError(m.server_site_not_found())
    }

    await audit(
      {
        organizationId: existing.organizationId,
        siteId: id,
        actorId,
        action: 'site.update',
        targetType: 'site',
        targetId: id,
        meta: {
          fields: changed,
          ...(patch.publishingMode !== undefined
            ? {
                publishingMode: patch.publishingMode,
                previousPublishingMode: existing.publishingMode,
              }
            : {}),
          ...('deploymentTarget' in patch
            ? {
                deploymentTarget: patch.deploymentTarget?.applicationId ?? null,
              }
            : {}),
        },
      },
      tx,
    )
    return row
  })

  return toPublicSite(updated)
}

/**
 * Changes a site's slug, which is its key in the CMS: the MCP connector URL
 * and each project's `--site-key` use it, so old links stop working. The
 * slug must be unique and follow the shared rule.
 */
export async function changeSiteSlug(
  id: string,
  slug: string,
  actorId: string,
) {
  const existing = (
    await db.select().from(site).where(eq(site.id, id)).limit(1)
  ).at(0)
  if (!existing) {
    throw new NotFoundError(m.server_site_not_found())
  }
  if (slug === existing.slug) return toPublicSite(existing)
  assertSiteSlug(slug)

  const taken = (
    await db
      .select({ id: site.id })
      .from(site)
      .where(eq(site.slug, slug))
      .limit(1)
  ).at(0)
  if (taken) {
    throw new ConflictError(m.server_slug_already_exists())
  }

  try {
    const updated = await db.transaction(async (tx) => {
      const row = (
        await tx
          .update(site)
          .set({ slug, updatedAt: new Date() })
          .where(eq(site.id, id))
          .returning()
      ).at(0)
      if (!row) {
        throw new NotFoundError(m.server_site_not_found())
      }
      await audit(
        {
          organizationId: existing.organizationId,
          siteId: id,
          actorId,
          action: 'site.update',
          targetType: 'site',
          targetId: id,
          meta: { fields: ['slug'], previousSlug: existing.slug, slug },
        },
        tx,
      )
      return row
    })
    return toPublicSite(updated)
  } catch (error) {
    // A slug taken between the check above and the update.
    if (isUniqueViolation(error)) {
      throw new ConflictError(m.server_slug_already_exists())
    }
    throw error
  }
}

export async function rotateSiteTokenAdmin(
  id: string,
  privilege: 'build' | 'schema' = 'build',
  actorId: string,
) {
  const existing = (
    await db.select().from(site).where(eq(site.id, id)).limit(1)
  ).at(0)
  if (!existing) {
    throw new NotFoundError(m.server_site_not_found())
  }

  const generated = generateSiteToken()
  await db.transaction(async (tx) => {
    await tx
      .update(site)
      .set({
        ...(privilege === 'schema'
          ? { schemaTokenHash: generated.hash }
          : { tokenHash: generated.hash }),
        updatedAt: new Date(),
      })
      .where(eq(site.id, id))

    await audit(
      {
        organizationId: existing.organizationId,
        siteId: id,
        actorId,
        action:
          privilege === 'schema'
            ? 'site.rotate_schema_token'
            : 'site.rotate_token',
        targetType: 'site',
        targetId: id,
      },
      tx,
    )
  })

  return { token: generated.token }
}

export async function deleteSite(id: string, actorId: string) {
  const existing = (
    await db.select().from(site).where(eq(site.id, id)).limit(1)
  ).at(0)
  if (!existing) {
    throw new NotFoundError(m.server_site_not_found())
  }

  await db.transaction(async (tx) => {
    await lockOrganizationForMutation(tx, existing.organizationId)
    const locked = (
      await tx.select().from(site).where(eq(site.id, id)).for('update')
    ).at(0)
    if (!locked) throw new NotFoundError(m.server_site_not_found())
    await assertSiteHasNoPendingDeployment(tx, id)
    await archiveDeletedContent(tx, existing.organizationId, 'site', id)
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
    // Written before the delete: audit_log.site_id is set null afterwards.
    await audit(
      {
        organizationId: existing.organizationId,
        siteId: id,
        actorId,
        action: 'site.delete',
        targetType: 'site',
        targetId: id,
        meta: { slug: existing.slug },
      },
      tx,
    )
    await tx.delete(site).where(eq(site.id, id))
  })
}
