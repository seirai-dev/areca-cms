import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

import { db } from '#/db'
import { site } from '#/db/schema'
import { requireAgencyAdmin, requireOrgMember } from '#/lib/session.server'
import type { EntryStatus, FieldType } from '#/lib/types'
import {
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
import {
  buildPreviewUrl,
  signPreviewToken,
} from '#/server/content/preview-token'
import { eq } from 'drizzle-orm'

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
] as const satisfies readonly FieldType[]

const fieldSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  type: z.enum(fieldTypes),
  required: z.boolean().optional(),
  options: z.array(z.string()).optional(),
  collection: z.string().optional(),
  description: z.string().optional(),
})

const entryStatusSchema = z.enum([
  'draft',
  'published',
  'scheduled',
  'archived',
]) satisfies z.ZodType<EntryStatus>

const entryDataSchema = z.record(z.string(), z.unknown())

const entryFn = { strict: { output: false } as const }

async function requireSiteAccess(siteId: string) {
  const [found] = await db
    .select()
    .from(site)
    .where(eq(site.id, siteId))
    .limit(1)
  if (!found) {
    throw new NotFoundError('Site not found')
  }
  const session = await requireOrgMember(found.organizationId)
  return { session, site: found }
}

async function requireEntryAccess(entryId: string) {
  const existing = await getEntry(entryId)
  if (!existing) {
    throw new NotFoundError('Entry not found')
  }
  const access = await requireSiteAccess(existing.siteId)
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
      limit: z.number().int().min(0).optional(),
      offset: z.number().int().min(0).optional(),
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
    return entry
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
    const { session } = await requireEntryAccess(data.id)
    return publishEntry(data.id, session.user.id)
  })

export const unpublishEntryFn = createServerFn({ method: 'POST', ...entryFn })
  .validator(z.object({ id: z.string().min(1) }))
  .handler(async ({ data }) => {
    const { session } = await requireEntryAccess(data.id)
    return unpublishEntry(data.id, session.user.id)
  })

export const archiveEntryFn = createServerFn({ method: 'POST', ...entryFn })
  .validator(z.object({ id: z.string().min(1) }))
  .handler(async ({ data }) => {
    const { session } = await requireEntryAccess(data.id)
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
    const { session } = await requireEntryAccess(data.id)
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
    const { session } = await requireEntryAccess(data.id)
    return cancelSchedule(data.id, session.user.id)
  })

export const deleteEntryFn = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string().min(1) }))
  .handler(async ({ data }) => {
    const { session } = await requireEntryAccess(data.id)
    await deleteEntry(data.id, session.user.id)
    return { ok: true as const }
  })

export const listRevisionsFn = createServerFn({ method: 'GET', ...entryFn })
  .validator(z.object({ entryId: z.string().min(1) }))
  .handler(async ({ data }) => {
    await requireEntryAccess(data.entryId)
    return listRevisions(data.entryId)
  })

export const restoreRevisionFn = createServerFn({ method: 'POST', ...entryFn })
  .validator(
    z.object({
      entryId: z.string().min(1),
      revisionId: z.string().min(1),
    }),
  )
  .handler(async ({ data }) => {
    const { session } = await requireEntryAccess(data.entryId)
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
      label: z.string().min(1),
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
