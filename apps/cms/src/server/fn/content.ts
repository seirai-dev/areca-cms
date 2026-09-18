import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

import { db } from '#/db'
import { site, user } from '#/db/schema'
import { requireAgencyAdmin, requireOrgMember } from '#/lib/session.server'
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
  key: z.string().trim().min(1),
  label: z.string().trim().min(1),
  type: z.enum(fieldTypes),
  required: z.boolean().optional(),
  options: z.array(z.string()).optional(),
  collection: z.string().optional(),
  description: z.string().optional(),
  after: z.string().min(1).optional(),
})

const entryStatusSchema = z.enum([
  'draft',
  'published',
  'scheduled',
  'archived',
]) satisfies z.ZodType<EntryStatus>

const entryDataSchema = z.record(z.string(), z.unknown())

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

async function requireSiteAccess(siteId: string, role?: 'owner') {
  const found = (
    await db.select().from(site).where(eq(site.id, siteId)).limit(1)
  ).at(0)
  if (!found) {
    throw new NotFoundError(m.server_site_not_found())
  }
  const session = await requireOrgMember(found.organizationId, role)
  return { session, site: found }
}

async function requireEntryAccess(entryId: string, role?: 'owner') {
  const existing = await getEntry(entryId)
  if (!existing) {
    throw new NotFoundError(m.server_entry_not_found())
  }
  const access = await requireSiteAccess(existing.siteId, role)
  return { ...access, entry: existing }
}

export const listCollectionsFn = createServerFn({ method: 'GET' })
  .validator(
    z.object({
      siteId: z.string().min(1),
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
      siteId: z.string().min(1),
      collectionKey: z.string().min(1),
      status: entryStatusSchema.optional(),
      search: z.string().optional(),
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
  .validator(z.object({ id: z.string().min(1) }))
  .handler(async ({ data }) => {
    const { entry } = await requireEntryAccess(data.id)
    const names = await userNames([entry.createdBy, entry.updatedBy])
    return {
      ...entry,
      createdByName: entry.createdBy ? (names.get(entry.createdBy) ?? null) : null,
      updatedByName: entry.updatedBy ? (names.get(entry.updatedBy) ?? null) : null,
    }
  })

export const createEntryFn = createServerFn({ method: 'POST', ...entryFn })
  .validator(
    z.object({
      siteId: z.string().min(1),
      collectionKey: z.string().min(1),
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
      id: z.string().min(1),
      data: entryDataSchema,
    }),
  )
  .handler(async ({ data }) => {
    const { session } = await requireEntryAccess(data.id)
    return updateDraft(data.id, data.data, session.user.id)
  })

export const publishEntryFn = createServerFn({ method: 'POST', ...entryFn })
  .validator(z.object({ id: z.string().min(1) }))
  .handler(async ({ data }) => {
    const { session } = await requireEntryAccess(data.id, 'owner')
    return publishEntry(data.id, session.user.id)
  })

export const unpublishEntryFn = createServerFn({ method: 'POST', ...entryFn })
  .validator(z.object({ id: z.string().min(1) }))
  .handler(async ({ data }) => {
    const { session } = await requireEntryAccess(data.id, 'owner')
    return unpublishEntry(data.id, session.user.id)
  })

export const archiveEntryFn = createServerFn({ method: 'POST', ...entryFn })
  .validator(z.object({ id: z.string().min(1) }))
  .handler(async ({ data }) => {
    const { session } = await requireEntryAccess(data.id, 'owner')
    return archiveEntry(data.id, session.user.id)
  })

export const scheduleEntryFn = createServerFn({ method: 'POST', ...entryFn })
  .validator(
    z.object({
      id: z.string().min(1),
      scheduledAt: z.string().min(1),
      timezone: z.string().min(1),
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
  .validator(z.object({ id: z.string().min(1) }))
  .handler(async ({ data }) => {
    const { session } = await requireEntryAccess(data.id, 'owner')
    return cancelSchedule(data.id, session.user.id)
  })

export const deleteEntryFn = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string().min(1) }))
  .handler(async ({ data }) => {
    const { session } = await requireEntryAccess(data.id, 'owner')
    await deleteEntry(data.id, session.user.id)
    return { ok: true as const }
  })

export const listRevisionsFn = createServerFn({ method: 'GET', ...entryFn })
  .validator(z.object({ entryId: z.string().min(1) }))
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
      entryId: z.string().min(1),
      revisionId: z.string().min(1),
    }),
  )
  .handler(async ({ data }) => {
    const { session } = await requireEntryAccess(data.entryId, 'owner')
    return restoreRevision(data.entryId, data.revisionId, session.user.id)
  })

export const getPreviewUrlFn = createServerFn({ method: 'GET' })
  .validator(
    z.object({
      siteId: z.string().min(1),
      collection: z.string().min(1),
      slug: z.string().min(1),
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
      siteId: z.string().min(1),
      key: z.string().min(1),
      label: z.string().trim().min(1),
      routePattern: z.string().min(1),
      fields: z.array(fieldSchema),
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
      siteId: z.string().min(1),
      key: z.string().min(1),
    }),
  )
  .handler(async ({ data }) => {
    const session = await requireAgencyAdmin()
    await deleteCollection(data.siteId, data.key, session.user.id)
    return { ok: true as const }
  })
