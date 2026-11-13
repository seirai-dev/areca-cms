import { isSafeIdentifier } from '#/lib/content-identifiers'
import { localeTagSchema } from '#/lib/locale-tag-schema'
import {
  GLOBAL_GROUP_MAX_LENGTH,
  GLOBAL_PREVIEW_PATH_MAX_LENGTH,
} from '#/lib/globals'
import {
  FIELD_DESCRIPTION_MAX_LENGTH,
  FIELD_LABEL_MAX_LENGTH,
  FIELD_MAX_OPTIONS,
  FIELD_OPTION_MAX_LENGTH,
  ID_MAX_LENGTH,
  MAX_FIELDS_PER_COLLECTION,
  MAX_SITE_LANGUAGES,
  ROUTE_PATTERN_MAX_LENGTH,
  BULK_ENTRY_MAX_IDS,
  SCHEDULE_FIELD_MAX_LENGTH,
  SEARCH_MAX_LENGTH,
  SLUG_MAX_LENGTH,
} from '#/lib/content-limits'
import { createServerFn } from '@tanstack/react-start'
import { entryTitle } from '#/lib/content/utils'
import { z } from '#/lib/zod'

import { db } from '#/db'
import { user } from '#/db/schema'
import { requireAgencyAdmin } from '#/lib/session.server'
import type { EntryStatus, FieldType } from '#/lib/types'
import { m } from '#/paraglide/messages'
import {
  deleteCollection,
  listCollections,
  upsertCollection,
} from '#/server/content/collections'
import { entryDataSchema } from '#/server/content/validation'
import {
  archiveEntry,
  cancelSchedule,
  createEntry,
  deleteEntry,
  countEntriesByCollection,
  listEntrySummaries,
  listSiteEntrySummaries,
  listRevisions,
  publishEntry,
  restoreRevision,
  scheduleEntry,
  unpublishEntry,
  updateDraft,
} from '#/server/content/entries'
import {
  applyBulkEntryAction,
  BULK_ENTRY_ACTIONS,
} from '#/server/content/entry-actions'
import { listInboundReferences } from '#/server/content/inbound-references'
import { resolvePreviewOwners } from '#/server/content/preview-owners'
import { NotFoundError } from '#/server/content/errors'
import {
  requireEntryAccess,
  requireGlobalAccess,
  requireSiteAccess,
} from '#/server/content/access'
import {
  attachSectionLinkers,
  applySectionLinkUpdates,
} from '#/server/content/section-link-updates'
import { linkedFromEntry } from '#/server/content/linked-from'
import { AppError } from '#/server/http/app-error'
import { pageLimitSchema, pageOffsetSchema } from '#/server/pagination'
import {
  deleteGlobal,
  discardGlobalDraft,
  listGlobals,
  setGlobalEnabled,
  upsertGlobal,
} from '#/server/content/globals'
import { fieldDataUsageForCollection } from '#/server/content/field-data'
import { previewLinkFor } from '#/server/content/preview-token'
import { inArray } from 'drizzle-orm'

const fieldTypes = [
  'text',
  'textarea',
  'richtext',
  'image',
  'date',
  'datetime',
  'select',
  'reference',
  'slug',
  'boolean',
  'number',
  'url',
] as const satisfies readonly FieldType[]

const fieldSchema = z.object({
  key: z.string().refine(isSafeIdentifier, 'Unsafe identifier'),
  label: z.string().trim().min(1).max(FIELD_LABEL_MAX_LENGTH),
  type: z.enum(fieldTypes),
  required: z.boolean().optional(),
  options: z
    .array(z.string().max(FIELD_OPTION_MAX_LENGTH))
    .max(FIELD_MAX_OPTIONS)
    .optional(),
  collection: z.string().max(FIELD_OPTION_MAX_LENGTH).optional(),
  description: z.string().max(FIELD_DESCRIPTION_MAX_LENGTH).optional(),
  after: z.string().min(1).max(FIELD_OPTION_MAX_LENGTH).optional(),
  translatable: z.boolean().optional(),
})

/** Site content fields: collection field rules plus an editor-only group heading. */
const globalFieldSchema = fieldSchema.extend({
  group: z.string().min(1).max(GLOBAL_GROUP_MAX_LENGTH).optional(),
})

const entryStatusSchema = z.enum([
  'draft',
  'published',
  'scheduled',
  'archived',
]) satisfies z.ZodType<EntryStatus>

const entryFn = { strict: { output: false } as const }

/**
 * Display names for a set of user ids. The UI shows who wrote an entry; the
 * public API keeps returning raw ids, so the join lives here and not in
 * `src/server/content`.
 */
async function userNames(ids: (string | null | undefined)[]) {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))]
  if (unique.length === 0) return new Map<string, string>()
  const rows = await db
    .select({ id: user.id, name: user.name, email: user.email })
    .from(user)
    .where(inArray(user.id, unique))
  return new Map(rows.map((row) => [row.id, row.name || row.email]))
}

/** Field keys the owner confirmed removing together with their content. */
const confirmDropFieldsSchema = z
  .array(z.string().min(1).max(FIELD_OPTION_MAX_LENGTH))
  .max(MAX_FIELDS_PER_COLLECTION)
  .optional()

/** Content counts per field key of one collection or section (schema editor). */
export const fieldDataUsageFn = createServerFn({ method: 'GET' })
  .validator(
    z.object({
      siteId: z.string().min(1).max(ID_MAX_LENGTH),
      key: z.string().min(1).max(ID_MAX_LENGTH),
    }),
  )
  .handler(async ({ data }) => {
    await requireSiteAccess(data.siteId)
    return fieldDataUsageForCollection(data.siteId, data.key)
  })

export const listCollectionsFn = createServerFn({ method: 'GET' })
  .validator(
    z.object({
      siteId: z.string().min(1).max(ID_MAX_LENGTH),
      enabledOnly: z.boolean().optional(),
    }),
  )
  .handler(async ({ data }) => {
    await requireSiteAccess(data.siteId)
    return listCollections(data.siteId, { enabledOnly: data.enabledOnly })
  })

export const listEntriesFn = createServerFn({ method: 'GET', ...entryFn })
  .validator(
    z.object({
      siteId: z.string().min(1).max(ID_MAX_LENGTH),
      collectionKey: z.string().min(1).max(ID_MAX_LENGTH),
      status: entryStatusSchema.optional(),
      referenceTargets: z.boolean().optional(),
      search: z.string().max(SEARCH_MAX_LENGTH).optional(),
      /** Only entries not complete in this language. */
      missingLanguage: localeTagSchema.optional(),
      limit: pageLimitSchema.optional(),
      offset: pageOffsetSchema.optional(),
    }),
  )
  .handler(async ({ data }) => {
    const { site } = await requireSiteAccess(data.siteId)
    return listEntrySummaries(data.siteId, data.collectionKey, {
      languages: site.languages,
      status: data.status,
      referenceTargets: data.referenceTargets,
      search: data.search,
      missingLanguage: data.missingLanguage,
      limit: data.limit,
      offset: data.offset,
    })
  })

/**
 * The overview's lists in one request each: the newest entries across the
 * site's collections, or (owners) drafts last saved by someone else. Same
 * collections as the sidebar.
 */
export const listRecentEntriesFn = createServerFn({ method: 'GET', ...entryFn })
  .validator(
    z.object({
      siteId: z.string().min(1).max(ID_MAX_LENGTH),
      draftsByOthers: z.boolean().optional(),
      limit: z.number().int().min(1).max(20),
    }),
  )
  .handler(async ({ data }) => {
    const { session, site } = await requireSiteAccess(data.siteId)
    return listSiteEntrySummaries(data.siteId, {
      enabledOnly: !session.user.isAgencyAdmin,
      languages: site.languages,
      status: data.draftsByOthers ? 'draft' : undefined,
      excludeUpdatedBy: data.draftsByOthers ? session.user.id : undefined,
      limit: data.limit,
    })
  })

/**
 * Entries per collection key, for the sidebar and the mobile bar. One query
 * for the whole site. Non-admins get only the collections they can open
 * (switched-off ones are hidden from them), the same set the sidebar lists.
 */
export const listEntryCountsFn = createServerFn({ method: 'GET' })
  .validator(z.object({ siteId: z.string().min(1).max(ID_MAX_LENGTH) }))
  .handler(async ({ data }) => {
    const { session } = await requireSiteAccess(data.siteId)
    return countEntriesByCollection(data.siteId, {
      enabledOnly: !session.user.isAgencyAdmin,
    })
  })

export const listInboundReferencesFn = createServerFn({
  method: 'GET',
  ...entryFn,
})
  .validator(z.object({ id: z.string().min(1).max(ID_MAX_LENGTH) }))
  .handler(async ({ data }) => {
    const { session } = await requireEntryAccess(data.id)
    return listInboundReferences(data.id, session.user.isAgencyAdmin)
  })

/**
 * The entry as the editor sees it: the heading and dev origin baselines stay
 * on the server.
 */
function withoutBaselines<
  T extends { headingBaseline: unknown; originBaseline: unknown },
>(row: T) {
  const { headingBaseline: _heading, originBaseline: _origin, ...rest } = row
  return rest
}

/**
 * What the editor reads back after a save. A draft save never changes the
 * ready or scheduled copy, so those stay out of the reply too; the editor
 * keeps the copies it loaded.
 */
function saveReply<
  T extends {
    headingBaseline: unknown
    originBaseline: unknown
    publishedData: unknown
    scheduledData: unknown
  },
>(saved: T) {
  const {
    publishedData: _published,
    scheduledData: _scheduled,
    ...rest
  } = withoutBaselines(saved)
  return rest
}

export const getEntryFn = createServerFn({ method: 'GET', ...entryFn })
  .validator(z.object({ id: z.string().min(1).max(ID_MAX_LENGTH) }))
  .handler(async ({ data }) => {
    const { entry, createdByName, updatedByName } = await requireEntryAccess(
      data.id,
    )
    return { ...withoutBaselines(entry), createdByName, updatedByName }
  })

/** What a reference field shows for its chosen entry: the title, not the record. */
export const getEntryTitleFn = createServerFn({ method: 'GET', ...entryFn })
  .validator(z.object({ id: z.string().min(1).max(ID_MAX_LENGTH) }))
  .handler(async ({ data }) => {
    const { entry, collection } = await requireEntryAccess(data.id)
    return {
      id: entry.id,
      title: entryTitle(entry.draftData, collection.fields, entry.slug),
    }
  })

export const createEntryFn = createServerFn({ method: 'POST', ...entryFn })
  .validator(
    z.object({
      siteId: z.string().min(1).max(ID_MAX_LENGTH),
      collectionKey: z.string().min(1).max(ID_MAX_LENGTH),
      data: entryDataSchema,
    }),
  )
  .handler(async ({ data }) => {
    const { session } = await requireSiteAccess(data.siteId)
    return createEntry({
      siteId: data.siteId,
      collectionKey: data.collectionKey,
      data: data.data,
      actorId: session.user.id,
    })
  })

export const updateDraftFn = createServerFn({ method: 'POST', ...entryFn })
  .validator(
    z.object({
      id: z.string().min(1).max(ID_MAX_LENGTH),
      data: entryDataSchema,
      expectedVersion: z.number().int().positive(),
      /** Set by Save, ⌘S and Mark ready; autosaves leave it out. */
      explicit: z.boolean().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const access = await requireEntryAccess(data.id)
    const { session, entry, collection, site } = access
    // The guard already read the entry, collection and site; the save reuses
    // them. The version check in the UPDATE still catches a concurrent save.
    const saved = await updateDraft(
      data.id,
      data.data,
      session.user.id,
      data.expectedVersion,
      { entry, collection, site },
      { explicit: data.explicit === true },
    )
    return {
      ...saveReply(saved),
      sectionChanges: await attachSectionLinkers(
        data.id,
        saved.sectionChanges,
        sectionViewer(access),
      ),
    }
  })

/**
 * The entries and site sections that link to this entry, per language
 * (docs/design/rich-text-links.md, decision 20).
 */
export const listLinkedFromFn = createServerFn({ method: 'GET', ...entryFn })
  .validator(z.object({ id: z.string().min(1).max(ID_MAX_LENGTH) }))
  .handler(async ({ data }) => {
    const { session } = await requireEntryAccess(data.id)
    return linkedFromEntry(data.id, {
      isAgencyAdmin: session.user.isAgencyAdmin,
    })
  })

/**
 * Points links to changed sections at their new sections (decision 21). The
 * caller must be able to edit this entry; the linking entries it may not edit
 * are reported as skipped.
 */
export const applySectionLinkUpdatesFn = createServerFn({
  method: 'POST',
  ...entryFn,
})
  .validator(
    z.object({
      id: z.string().min(1).max(ID_MAX_LENGTH),
      updates: z
        .array(
          z.object({
            locale: z.string().max(32),
            from: z.string().min(1).max(200),
            to: z.string().max(200),
          }),
        )
        .max(100),
    }),
  )
  .handler(async ({ data }) => {
    const access = await requireEntryAccess(data.id)
    return applySectionLinkUpdates({
      targetId: data.id,
      actorId: access.session.user.id,
      viewer: sectionViewer(access),
      updates: data.updates,
    })
  })

/** What the caller may do with the entries of this site (see `needsApproval`). */
function sectionViewer(access: {
  member: { role: 'owner' | 'editor' } | null
  session: { user: { isAgencyAdmin: boolean } }
}) {
  return {
    isOwner: access.member === null || access.member.role === 'owner',
    isAgencyAdmin: access.session.user.isAgencyAdmin,
  }
}

export const publishEntryFn = createServerFn({ method: 'POST', ...entryFn })
  .validator(
    z.object({
      id: z.string().min(1).max(ID_MAX_LENGTH),
      /** The draft version the reviewer saw; a later version is a conflict. */
      expectedVersion: z.number().int().positive().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const { session } = await requireEntryAccess(data.id, 'owner')
    return publishEntry(data.id, session.user.id, data.expectedVersion)
  })

export const unpublishEntryFn = createServerFn({ method: 'POST', ...entryFn })
  .validator(z.object({ id: z.string().min(1).max(ID_MAX_LENGTH) }))
  .handler(async ({ data }) => {
    const { session } = await requireEntryAccess(data.id, 'owner')
    return unpublishEntry(data.id, session.user.id)
  })

export const archiveEntryFn = createServerFn({ method: 'POST', ...entryFn })
  .validator(z.object({ id: z.string().min(1).max(ID_MAX_LENGTH) }))
  .handler(async ({ data }) => {
    const { session } = await requireEntryAccess(data.id, 'owner')
    return archiveEntry(data.id, session.user.id)
  })

export const scheduleEntryFn = createServerFn({ method: 'POST', ...entryFn })
  .validator(
    z.object({
      id: z.string().min(1).max(ID_MAX_LENGTH),
      scheduledAt: z.string().min(1).max(SCHEDULE_FIELD_MAX_LENGTH),
      timezone: z.string().min(1).max(SCHEDULE_FIELD_MAX_LENGTH),
      expectedVersion: z.number().int().positive().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const { session } = await requireEntryAccess(data.id, 'owner')
    return scheduleEntry(
      data.id,
      data.scheduledAt,
      data.timezone,
      session.user.id,
      data.expectedVersion,
    )
  })

export const cancelScheduleFn = createServerFn({ method: 'POST', ...entryFn })
  .validator(z.object({ id: z.string().min(1).max(ID_MAX_LENGTH) }))
  .handler(async ({ data }) => {
    const { session } = await requireEntryAccess(data.id, 'owner')
    return cancelSchedule(data.id, session.user.id)
  })

export const deleteEntryFn = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string().min(1).max(ID_MAX_LENGTH) }))
  .handler(async ({ data }) => {
    const { session } = await requireEntryAccess(data.id, 'owner')
    await deleteEntry(data.id, session.user.id)
    return { ok: true as const }
  })

const bulkEntryActionSchema = z.object({
  siteId: z.string().min(1).max(ID_MAX_LENGTH),
  action: z.enum(BULK_ENTRY_ACTIONS),
  ids: z
    .array(z.string().min(1).max(ID_MAX_LENGTH))
    .min(1)
    .max(BULK_ENTRY_MAX_IDS),
})

export type BulkEntryActionResult = { id: string; ok: boolean; error?: string }

/**
 * One single-entry action on one entry, with that action's rules: owner only,
 * and the entry must belong to the site. A failure is returned, not thrown,
 * so the rest of the batch still runs.
 */
async function runBulkEntryAction(
  siteId: string,
  action: z.infer<typeof bulkEntryActionSchema>['action'],
  id: string,
): Promise<BulkEntryActionResult> {
  try {
    const { session, entry: found } = await requireEntryAccess(id, 'owner')
    if (found.siteId !== siteId) {
      throw new NotFoundError(m.server_entry_not_found())
    }
    await applyBulkEntryAction(action, id, session.user.id)
    return { id, ok: true }
  } catch (error) {
    return {
      id,
      ok: false,
      error:
        error instanceof AppError
          ? error.message
          : m.shared_something_went_wrong(),
    }
  }
}

/**
 * Bulk entry actions on a normal site (docs/design/dev-environments.md,
 * Decision 19). Not all-or-nothing: each id gets its own result, and the
 * caller shows the failures. Owners only, as each single action is.
 */
export const bulkEntryActionFn = createServerFn({ method: 'POST', ...entryFn })
  .validator(bulkEntryActionSchema)
  .handler(async ({ data }) => {
    await requireSiteAccess(data.siteId, 'owner')
    const results: BulkEntryActionResult[] = []
    for (const id of new Set(data.ids)) {
      results.push(await runBulkEntryAction(data.siteId, data.action, id))
    }
    return { results }
  })

/** One history page, newest first, without revision data. */
export const listRevisionsFn = createServerFn({ method: 'GET', ...entryFn })
  .validator(
    z.object({
      entryId: z.string().min(1).max(ID_MAX_LENGTH),
      cursor: z.string().min(1).max(ID_MAX_LENGTH).nullish(),
      limit: z.number().int().min(1).max(100).optional(),
    }),
  )
  .handler(async ({ data }) => {
    await requireEntryAccess(data.entryId)
    const page = await listRevisions(data.entryId, {
      cursor: data.cursor,
      limit: data.limit,
    })
    const names = await userNames(page.items.map((rev) => rev.createdBy))
    return {
      items: page.items.map((rev) => ({
        ...rev,
        createdByName: rev.createdBy
          ? (names.get(rev.createdBy) ?? null)
          : null,
      })),
      nextCursor: page.nextCursor,
    }
  })

export const restoreRevisionFn = createServerFn({ method: 'POST', ...entryFn })
  .validator(
    z.object({
      entryId: z.string().min(1).max(ID_MAX_LENGTH),
      revisionId: z.string().min(1).max(ID_MAX_LENGTH),
      expectedVersion: z.number().int().positive(),
    }),
  )
  .handler(async ({ data }) => {
    const { session } = await requireEntryAccess(data.entryId, 'owner')
    return restoreRevision(
      data.entryId,
      data.revisionId,
      session.user.id,
      data.expectedVersion,
    )
  })

export const getPreviewUrlFn = createServerFn({ method: 'GET' })
  .validator(
    z.object({
      siteId: z.string().min(1).max(ID_MAX_LENGTH),
      collection: z.string().min(1).max(ID_MAX_LENGTH),
      slug: z.string().min(1).max(SLUG_MAX_LENGTH),
      /** Language to preview. Omitted = main language. */
      locale: localeTagSchema.optional(),
    }),
  )
  .handler(async ({ data }) => {
    const { site: found } = await requireSiteAccess(data.siteId)
    return previewLinkFor(
      found,
      { kind: 'collection', key: data.collection, slug: data.slug },
      data.locale,
    )
  })

/**
 * Which owners a preview marks really exist on this site and the caller may
 * edit them (Visual editor, Decision 15). GET, so it does not count against the
 * mutation rate budget.
 */
export const resolvePreviewOwnersFn = createServerFn({ method: 'GET' })
  .validator(
    z.object({
      siteId: z.string().min(1).max(ID_MAX_LENGTH),
      owners: z
        .array(
          z.union([
            z.object({ entry: z.string().min(1).max(200) }).strict(),
            z.object({ global: z.string().min(1).max(200) }).strict(),
          ]),
        )
        .max(100),
    }),
  )
  .handler(async ({ data }) => {
    const { session } = await requireSiteAccess(data.siteId)
    return resolvePreviewOwners(data.siteId, data.owners, {
      isAgencyAdmin: session.user.isAgencyAdmin,
    })
  })

export const upsertCollectionFn = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      siteId: z.string().min(1).max(ID_MAX_LENGTH),
      key: z.string().refine(isSafeIdentifier, 'Unsafe identifier'),
      label: z.string().trim().min(1).max(FIELD_LABEL_MAX_LENGTH),
      routePattern: z.string().min(1).max(ROUTE_PATTERN_MAX_LENGTH),
      fields: z.array(fieldSchema).max(MAX_FIELDS_PER_COLLECTION),
      enabled: z.boolean().optional(),
      requiredLanguages: z
        .array(localeTagSchema)
        .max(MAX_SITE_LANGUAGES)
        .optional(),
      localizedRoutes: z
        .record(
          localeTagSchema,
          z.string().min(1).max(ROUTE_PATTERN_MAX_LENGTH),
        )
        .nullable()
        .optional(),
      confirmDropFields: confirmDropFieldsSchema,
    }),
  )
  .handler(async ({ data }) => {
    await requireAgencyAdmin()
    return upsertCollection(data.siteId, {
      key: data.key,
      label: data.label,
      routePattern: data.routePattern,
      fields: data.fields,
      confirmDropFields: data.confirmDropFields,
      enabled: data.enabled,
      requiredLanguages: data.requiredLanguages,
      localizedRoutes: data.localizedRoutes,
    })
  })

export const deleteCollectionFn = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      siteId: z.string().min(1).max(ID_MAX_LENGTH),
      key: z.string().refine(isSafeIdentifier, 'Unsafe identifier'),
    }),
  )
  .handler(async ({ data }) => {
    const session = await requireAgencyAdmin()
    await deleteCollection(data.siteId, data.key, session.user.id)
    return { ok: true as const }
  })

// Site content (globals) --------------------------------------------------
// Sections reuse the entry functions above for ready / schedule / restore /
// history (they take the section's entry id). The functions below add the
// section-level reads, the draft and discard, and the agency-only structure.

export const listGlobalsFn = createServerFn({ method: 'GET' })
  .validator(z.object({ siteId: z.string().min(1).max(ID_MAX_LENGTH) }))
  .handler(async ({ data }) => {
    const { session } = await requireSiteAccess(data.siteId)
    return listGlobals(data.siteId, {
      enabledOnly: !session.user.isAgencyAdmin,
    })
  })

export const getGlobalFn = createServerFn({ method: 'GET', ...entryFn })
  .validator(
    z.object({
      siteId: z.string().min(1).max(ID_MAX_LENGTH),
      key: z.string().min(1).max(ID_MAX_LENGTH),
    }),
  )
  .handler(async ({ data }) => {
    const { global, entry } = await requireGlobalAccess(data.siteId, data.key)
    const names = await userNames([entry.createdBy, entry.updatedBy])
    return {
      global,
      entry: {
        ...withoutBaselines(entry),
        createdByName: entry.createdBy
          ? (names.get(entry.createdBy) ?? null)
          : null,
        updatedByName: entry.updatedBy
          ? (names.get(entry.updatedBy) ?? null)
          : null,
      },
    }
  })

export const updateGlobalDraftFn = createServerFn({
  method: 'POST',
  ...entryFn,
})
  .validator(
    z.object({
      siteId: z.string().min(1).max(ID_MAX_LENGTH),
      key: z.string().min(1).max(ID_MAX_LENGTH),
      data: entryDataSchema,
      expectedVersion: z.number().int().positive(),
    }),
  )
  .handler(async ({ data }) => {
    const { session, entry } = await requireGlobalAccess(data.siteId, data.key)
    return saveReply(
      await updateDraft(
        entry.id,
        data.data,
        session.user.id,
        data.expectedVersion,
      ),
    )
  })

export const discardGlobalDraftFn = createServerFn({
  method: 'POST',
  ...entryFn,
})
  .validator(
    z.object({
      siteId: z.string().min(1).max(ID_MAX_LENGTH),
      key: z.string().min(1).max(ID_MAX_LENGTH),
    }),
  )
  .handler(async ({ data }) => {
    const { session } = await requireGlobalAccess(data.siteId, data.key)
    return discardGlobalDraft(data.siteId, data.key, session.user.id)
  })

/**
 * The section's preview URL on the site (`previewPath` + token), or null when
 * the agency has not set a preview path.
 */
export const getGlobalPreviewUrlFn = createServerFn({ method: 'GET' })
  .validator(
    z.object({
      siteId: z.string().min(1).max(ID_MAX_LENGTH),
      key: z.string().min(1).max(ID_MAX_LENGTH),
      /** Language to preview. Omitted = main language. */
      locale: localeTagSchema.optional(),
    }),
  )
  .handler(async ({ data }) => {
    const { site: found, global } = await requireGlobalAccess(
      data.siteId,
      data.key,
    )
    return previewLinkFor(
      found,
      { kind: 'global', key: data.key, previewPath: global.previewPath },
      data.locale,
    )
  })

export const upsertGlobalFn = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      siteId: z.string().min(1).max(ID_MAX_LENGTH),
      key: z.string().refine(isSafeIdentifier, 'Unsafe identifier'),
      label: z.string().trim().min(1).max(FIELD_LABEL_MAX_LENGTH),
      fields: z.array(globalFieldSchema).max(MAX_FIELDS_PER_COLLECTION),
      seo: z.boolean().optional(),
      previewPath: z
        .string()
        .max(GLOBAL_PREVIEW_PATH_MAX_LENGTH)
        .nullable()
        .optional(),
      enabled: z.boolean().optional(),
      requiredLanguages: z
        .array(localeTagSchema)
        .max(MAX_SITE_LANGUAGES)
        .optional(),
      confirmDropFields: confirmDropFieldsSchema,
    }),
  )
  .handler(async ({ data }) => {
    const session = await requireAgencyAdmin()
    return upsertGlobal(
      data.siteId,
      {
        key: data.key,
        label: data.label,
        fields: data.fields,
        confirmDropFields: data.confirmDropFields,
        seo: data.seo,
        previewPath: data.previewPath,
        enabled: data.enabled,
        requiredLanguages: data.requiredLanguages,
      },
      session.user.id,
    )
  })

export const setGlobalEnabledFn = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      siteId: z.string().min(1).max(ID_MAX_LENGTH),
      key: z.string().min(1).max(ID_MAX_LENGTH),
      enabled: z.boolean(),
    }),
  )
  .handler(async ({ data }) => {
    const session = await requireAgencyAdmin()
    return setGlobalEnabled(
      data.siteId,
      data.key,
      data.enabled,
      session.user.id,
    )
  })

export const deleteGlobalFn = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      siteId: z.string().min(1).max(ID_MAX_LENGTH),
      key: z.string().min(1).max(ID_MAX_LENGTH),
    }),
  )
  .handler(async ({ data }) => {
    const session = await requireAgencyAdmin()
    await deleteGlobal(data.siteId, data.key, session.user.id)
    return { ok: true as const }
  })
