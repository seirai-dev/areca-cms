import { createServerFn } from '@tanstack/react-start'
import { eq } from 'drizzle-orm'
import { db } from '#/db'
import { asset } from '#/db/schema'
import { z } from 'zod'

import {
  ALT_TEXT_MAX_LENGTH,
  ID_MAX_LENGTH,
  SEARCH_MAX_LENGTH,
} from '#/lib/content-limits'

import {
  requireOrgMember,
  requireOrgMemberOrNotFound,
  requireUser,
} from '#/lib/session.server'
import { m } from '#/paraglide/messages'
import { NotFoundError } from '#/server/content/errors'
import { deleteAsset, getAsset, listAssets, updateAsset } from '#/server/assets'
import { pageLimitSchema, pageOffsetSchema } from '#/server/pagination'

export const listAssetsFn = createServerFn({ method: 'GET' })
  .validator(
    z.object({
      organizationId: z.string().min(1).max(ID_MAX_LENGTH),
      search: z.string().max(SEARCH_MAX_LENGTH).optional(),
      limit: pageLimitSchema,
      offset: pageOffsetSchema,
    }),
  )
  .handler(async ({ data }) => {
    await requireOrgMember(data.organizationId)
    return listAssets(data.organizationId, {
      search: data.search,
      limit: data.limit,
      offset: data.offset,
    })
  })

export const getAssetFn = createServerFn({ method: 'GET' })
  .validator(z.object({ id: z.string().min(1).max(ID_MAX_LENGTH) }))
  .handler(async ({ data }) => {
    await requireUser()
    // Missing and not-accessible assets both answer null.
    return (await authorizedAsset(data.id)) ?? null
  })

export const updateAssetFn = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      id: z.string().min(1).max(ID_MAX_LENGTH),
      altText: z.string().max(ALT_TEXT_MAX_LENGTH),
    }),
  )
  .handler(async ({ data }) => {
    await requireUser()
    const existing = await authorizedAsset(data.id)
    if (!existing) {
      throw new NotFoundError(m.server_asset_not_found())
    }
    return updateAsset(
      data.id,
      { altText: data.altText },
      existing.organizationId,
    )
  })

export const deleteAssetFn = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      id: z.string().min(1).max(ID_MAX_LENGTH),
    }),
  )
  .handler(async ({ data }) => {
    await requireUser()
    const existing = await authorizedAsset(data.id, 'owner')
    if (!existing) {
      throw new NotFoundError(m.server_asset_not_found())
    }
    await deleteAsset(data.id, existing.organizationId)
    return { ok: true as const }
  })

/**
 * The asset, when it exists and the caller may act on it with `role`; otherwise
 * `undefined`. Non-members get the same answer as for a missing id; a member
 * with too low a role gets the 403.
 */
async function authorizedAsset(id: string, role?: 'owner') {
  const [owner] = await db
    .select({ organizationId: asset.organizationId })
    .from(asset)
    .where(eq(asset.id, id))
    .limit(1)
  if (!owner) return undefined
  const hidden = new NotFoundError(m.server_asset_not_found())
  try {
    await requireOrgMemberOrNotFound(owner.organizationId, role, () => hidden)
  } catch (error) {
    if (error === hidden) return undefined
    throw error
  }
  return getAsset(id, owner.organizationId)
}
