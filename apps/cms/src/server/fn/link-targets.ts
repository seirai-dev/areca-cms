import { createServerFn } from '@tanstack/react-start'

import { localeTagSchema } from '#/lib/locale-tag-schema'
import { ID_MAX_LENGTH } from '#/lib/content-limits'
import { z } from '#/lib/zod'
import { requireSiteAccess } from '#/server/content/access'
import {
  checkLinkTargets,
  linkTargetHeadings,
  searchLinkTargets,
} from '#/server/content/link-targets'
import { NotFoundError } from '#/server/content/errors'

/** What the link field may type: a title, a slug, a path or a URL. */
const LINK_QUERY_MAX_LENGTH = 200
/** Links one check looks at (a long text can hold many). */
const LINK_CHECK_MAX = 200

const linkFn = { strict: { output: false } as const }

/**
 * Entries a rich text link can point at (see server/content/link-targets.ts).
 * Only routed collections, never archived entries. Empty `query` lists the
 * newest entries. Non-admins see only the collections they may open.
 */
export const searchLinkTargetsFn = createServerFn({ method: 'GET', ...linkFn })
  .validator(
    z.object({
      siteId: z.string().min(1).max(ID_MAX_LENGTH),
      query: z.string().max(LINK_QUERY_MAX_LENGTH),
      locale: localeTagSchema.nullable(),
      limit: z.number().int().min(1).max(10).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const { session } = await requireSiteAccess(data.siteId)
    return searchLinkTargets(data.siteId, {
      query: data.query,
      locale: data.locale,
      limit: data.limit ?? 8,
      enabledOnly: !session.user.isAgencyAdmin,
    })
  })

/** The headings of an entry, in the language of the text that links to it. */
export const linkTargetHeadingsFn = createServerFn({ method: 'GET', ...linkFn })
  .validator(
    z.object({
      siteId: z.string().min(1).max(ID_MAX_LENGTH),
      entryId: z.string().min(1).max(ID_MAX_LENGTH),
      locale: localeTagSchema.nullable(),
    }),
  )
  .handler(async ({ data }) => {
    await requireSiteAccess(data.siteId)
    const found = await linkTargetHeadings(
      data.siteId,
      data.entryId,
      data.locale,
    )
    if (!found) throw new NotFoundError()
    return found
  })

/**
 * Whether the entry links in a text still work (the editor marks the ones that
 * do not). A POST because the list of links can be long.
 */
export const checkLinkTargetsFn = createServerFn({ method: 'POST', ...linkFn })
  .validator(
    z.object({
      siteId: z.string().min(1).max(ID_MAX_LENGTH),
      locale: localeTagSchema.nullable(),
      links: z
        .array(
          z.object({
            entryId: z.string().min(1).max(ID_MAX_LENGTH),
            anchor: z.string().max(200).nullable(),
          }),
        )
        .max(LINK_CHECK_MAX),
    }),
  )
  .handler(async ({ data }) => {
    await requireSiteAccess(data.siteId)
    return checkLinkTargets(data.siteId, data.locale, data.links)
  })
