import { isSafeIdentifier } from '#/lib/content-identifiers'
import {
  FIELD_DESCRIPTION_MAX_LENGTH,
  FIELD_LABEL_MAX_LENGTH,
  FIELD_MAX_OPTIONS,
  FIELD_OPTION_MAX_LENGTH,
  ID_MAX_LENGTH,
  MAX_FIELDS_PER_COLLECTION,
  ROUTE_PATTERN_MAX_LENGTH,
  SCHEDULE_FIELD_MAX_LENGTH,
  SEARCH_MAX_LENGTH,
  SLUG_MAX_LENGTH,
} from '#/lib/content-limits'
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

import { db } from '#/db'
import { site, user } from '#/db/schema'
import {
  requireAgencyAdmin,
  requireOrgMemberOrNotFound,
  requireUser,
} from '#/lib/session.server'
import type { EntryStatus, FieldType } from '#/lib/types'
import { m } from '#/paraglide/messages'
import {
  deleteCollection,
  listCollections,
  upsertCollection,
} from '#/server/content/collections'
import {
  archiveEntry,
  cancelSchedule,
  createEntry,
  deleteEntry,
  getEntry,
  listEntries,
  listRevisions,
  publishEntry,
  restoreRevision,
  scheduleEntry,
  unpublishEntry,
  updateDraft,
} from '#/server/content/entries'
import { NotFoundError } from '#/server/content/errors'
import { pageLimitSchema, pageOffsetSchema } from '#/server/pagination'
import {
  buildPreviewUrl,
  signPreviewToken,
} from '#/server/content/preview-token'
import { eq, inArray } from 'drizzle-orm'

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
})

const entryStatusSchema = z.enum([
  'draft',
  'published',
  'scheduled',
  'archived',
]) satisfies z.ZodType<EntryStatus>

const entryDataSchema = z
  .record(z.string(), z.unknown())
  .refine((data) => Object.keys(data).length <= MAX_FIELDS_PER_COLLECTION, {
    message: 'Too many fields',
  })

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

async function requireSiteAccess(
  siteId: string,
  role?: 'owner',
  notFoundMessage: () => ReturnType<
    typeof m.server_site_not_found
  > = m.server_site_not_found,
) {
  // Authenticate before looking anything up, and answer NotFound both for a
  // missing site and for one the caller has no access to, so site ids of
  // other tenants cannot be probed.
  await requireUser()
  const found = (
    await db.select().from(site).where(eq(site.id, siteId)).limit(1)
  ).at(0)
  if (!found) {
    throw new NotFoundError(notFoundMessage())
  }
  const session = await requireOrgMemberOrNotFound(
    found.organizationId,
    role,
    () => new NotFoundError(notFoundMessage()),
  )
  return { session, site: found }
}

async function requireEntryAccess(entryId: string, role?: 'owner') {
  await requireUser()
  const existing = await getEntry(entryId)
  if (!existing) {
    throw new NotFoundError(m.server_entry_not_found())
  }
  const access = await requireSiteAccess(
    existing.siteId,
    role,
    m.server_entry_not_found,
  )
  return { ...access, entry: existing }
}

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
      search: z.string().max(SEARCH_MAX_LENGTH).optional(),
      limit: pageLimitSchema.optional(),
      offset: pageOffsetSchema.optional(),
    }),
  )
  .handler(async ({ data }) => {
    await requireSiteAccess(data.siteId)
    return listEntries(data.siteId, data.collectionKey, {
      status: data.status,
      search: data.search,
      limit: data.limit,
      offset: data.offset,
    })
  })

export const getEntryFn = createServerFn({ method: 'GET', ...entryFn })
  .validator(z.object({ id: z.string().min(1).max(ID_MAX_LENGTH) }))
  .handler(async ({ data }) => {
    const { entry } = await requireEntryAccess(data.id)
    const names = await userNames([entry.createdBy, entry.updatedBy])
    return {
      ...entry,
      createdByName: entry.createdBy
        ? (names.get(entry.createdBy) ?? null)
        : null,
      updatedByName: entry.updatedBy
        ? (names.get(entry.updatedBy) ?? null)
        : null,
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
    }),
  )
  .handler(async ({ data }) => {
    const { session } = await requireEntryAccess(data.id)
    return updateDraft(
      data.id,
      data.data,
      session.user.id,
      data.expectedVersion,
    )
  })

export const publishEntryFn = createServerFn({ method: 'POST', ...entryFn })
  .validator(z.object({ id: z.string().min(1).max(ID_MAX_LENGTH) }))
  .handler(async ({ data }) => {
    const { session } = await requireEntryAccess(data.id, 'owner')
    return publishEntry(data.id, session.user.id)
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
    }),
  )
  .handler(async ({ data }) => {
    const { session } = await requireEntryAccess(data.id, 'owner')
    return scheduleEntry(
      data.id,
      data.scheduledAt,
      data.timezone,
      session.user.id,
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

export const listRevisionsFn = createServerFn({ method: 'GET', ...entryFn })
  .validator(z.object({ entryId: z.string().min(1).max(ID_MAX_LENGTH) }))
  .handler(async ({ data }) => {
    await requireEntryAccess(data.entryId)
    const revisions = await listRevisions(data.entryId)
    const names = await userNames(revisions.map((rev) => rev.createdBy))
    return revisions.map((rev) => ({
      ...rev,
      createdByName: rev.createdBy ? (names.get(rev.createdBy) ?? null) : null,
    }))
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
    }),
  )
  .handler(async ({ data }) => {
    const { site: found } = await requireSiteAccess(data.siteId)
    const token = signPreviewToken({
      siteId: found.id,
      collection: data.collection,
      slug: data.slug,
      secret: found.previewSecret,
    })
    return {
      token,
      url: buildPreviewUrl(
        found.productionUrl,
        data.collection,
        data.slug,
        token,
      ),
    }
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
    }),
  )
  .handler(async ({ data }) => {
    await requireAgencyAdmin()
    return upsertCollection(data.siteId, {
      key: data.key,
      label: data.label,
      routePattern: data.routePattern,
      fields: data.fields,
      enabled: data.enabled,
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
