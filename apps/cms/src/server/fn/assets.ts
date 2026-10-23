import { createServerFn } from '@tanstack/react-start'
import { eq } from 'drizzle-orm'
import { db } from '#/db'
import { asset, site } from '#/db/schema'
import { z } from 'zod'

import {
  ALT_TEXT_MAX_LENGTH,
  ID_MAX_LENGTH,
  SEARCH_MAX_LENGTH,
} from '#/lib/content-limits'

import { canonicalLocale, localeTagSchema } from '#/lib/content-locale'
import {
  requireOrgMember,
  requireOrgMemberOrNotFound,
  requireUser,
} from '#/lib/session.server'
import { m } from '#/paraglide/messages'
import { NotFoundError, ValidationError } from '#/server/content/errors'
import { deleteAsset, getAsset, listAssets, updateAsset } from '#/server/assets'
import { pageLimitSchema, pageOffsetSchema } from '#/server/pagination'

export const listAssetsFn = createServerFn({ method: 'GET' })
  .validator(
    z.object({
      organizationId: z.string().min(1).max(ID_MAX_LENGTH),
      search: z.string().max(SEARCH_MAX_LENGTH).optional(),
      imagesOnly: z.boolean().optional(),
      /**
       * Only images without a description in `locale` of `siteId`. Absent
       * `locale` means the site's main language.
       */
      missingAlt: z
        .object({
          siteId: z.string().min(1).max(ID_MAX_LENGTH),
          locale: localeTagSchema.optional(),
        })
        .optional(),
      limit: pageLimitSchema,
      offset: pageOffsetSchema,
    }),
  )
  .handler(async ({ data }) => {
    await requireOrgMember(data.organizationId)
    let missingAlt:
      { locale: string | null; mainLocale: string | null } | undefined
    if (data.missingAlt) {
      const found = (
        await db
          .select({
            organizationId: site.organizationId,
            languages: site.languages,
          })
          .from(site)
          .where(eq(site.id, data.missingAlt.siteId))
          .limit(1)
      ).at(0)
      if (!found || found.organizationId !== data.organizationId) {
        throw new NotFoundError(m.server_site_not_found())
      }
      const languages = found.languages
      // A single-language site has no per-language descriptions: main only.
      const locale =
        languages && data.missingAlt.locale
          ? canonicalLocale(data.missingAlt.locale)
          : null
      if (locale && !languages?.all.includes(locale)) {
        throw new ValidationError([
          {
            path: 'locale',
            message: 'This language is not one of the site languages.',
          },
        ])
      }
      missingAlt = { locale, mainLocale: languages?.main ?? null }
    }
    return listAssets(data.organizationId, {
      search: data.search,
      imagesOnly: data.imagesOnly,
      missingAlt,
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
      /** Language of `altText`. Absent or the site's main language writes `alt`. */
      locale: localeTagSchema.optional(),
      /** The site whose languages `locale` is checked against. */
      siteId: z.string().min(1).max(ID_MAX_LENGTH).optional(),
    }),
  )
  .handler(async ({ data }) => {
    await requireUser()
    const existing = await authorizedAsset(data.id)
    if (!existing) {
      throw new NotFoundError(m.server_asset_not_found())
    }
    const locale = data.locale ? canonicalLocale(data.locale) : null
    let mainLocale: string | null = null
    if (data.siteId) {
      const found = (
        await db
          .select({
            organizationId: site.organizationId,
            languages: site.languages,
          })
          .from(site)
          .where(eq(site.id, data.siteId))
          .limit(1)
      ).at(0)
      if (!found || found.organizationId !== existing.organizationId) {
        throw new NotFoundError(m.server_site_not_found())
      }
      mainLocale = found.languages?.main ?? null
      if (locale && !found.languages?.all.includes(locale)) {
        throw new ValidationError([
          {
            path: 'locale',
            message: 'This language is not one of the site languages.',
          },
        ])
      }
    }
    return updateAsset(
      data.id,
      { altText: data.altText, locale, mainLocale },
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
  const owner = (
    await db
      .select({ organizationId: asset.organizationId })
      .from(asset)
      .where(eq(asset.id, id))
      .limit(1)
  ).at(0)
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
