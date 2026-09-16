import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

import { requireOrgMember, requireUser } from '#/lib/session.server'
import { m } from '#/paraglide/messages'
import { deleteAsset, getAsset, listAssets, updateAsset } from '#/server/assets'

export const listAssetsFn = createServerFn({ method: 'GET' })
  .validator(
    z.object({
      organizationId: z.string().min(1),
      search: z.string().optional(),
      limit: z.number().int().min(1),
      offset: z.number().int().min(0),
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
  .validator(z.object({ id: z.string().min(1) }))
  .handler(async ({ data }) => {
    await requireUser()
    const existing = await getAsset(data.id)
    if (!existing) {
      return null
    }
    await requireOrgMember(existing.organizationId)
    return existing
  })

export const updateAssetFn = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      id: z.string().min(1),
      altText: z.string(),
    }),
  )
  .handler(async ({ data }) => {
    await requireUser()
    const existing = await getAsset(data.id)
    if (!existing) {
      throw new Error(m.server_asset_not_found())
    }
    await requireOrgMember(existing.organizationId)
    return updateAsset(data.id, { altText: data.altText })
  })

export const deleteAssetFn = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      id: z.string().min(1),
    }),
  )
  .handler(async ({ data }) => {
    await requireUser()
    const existing = await getAsset(data.id)
    if (!existing) {
      throw new Error(m.server_asset_not_found())
    }
    await requireOrgMember(existing.organizationId)
    await deleteAsset(data.id)
    return { ok: true as const }
  })
