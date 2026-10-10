import { archiveDeletedContent } from './deletion-archive'
import { and, eq, notInArray } from 'drizzle-orm'

import { db } from '#/db'
import { collection, site } from '#/db/schema'
import type { Field, SiteManifest } from '#/lib/types'
import { withRequiredSlugField } from '#/lib/collection-fields'
import { m } from '#/paraglide/messages'
import { isSafeIdentifier } from '#/lib/content-identifiers'
import { audit } from '#/server/audit'

import { NotFoundError, ValidationError } from './errors.ts'

export async function listCollections(
  siteId: string,
  options: { enabledOnly?: boolean } = {},
  connection: Pick<typeof db, 'select'> = db,
) {
  const filters = [eq(collection.siteId, siteId)]
  if (options.enabledOnly) {
    filters.push(eq(collection.enabled, true))
  }
  const rows = await connection
    .select()
    .from(collection)
    .where(and(...filters))
    .orderBy(collection.key)
  return rows.map((row) => ({
    ...row,
    fields: withRequiredSlugField(row.fields),
  }))
}

export async function getCollection(siteId: string, key: string) {
  const row = (
    await db
      .select()
      .from(collection)
      .where(and(eq(collection.siteId, siteId), eq(collection.key, key)))
      .limit(1)
  ).at(0)
  return row ? { ...row, fields: withRequiredSlugField(row.fields) } : null
}

export async function syncManifest(siteId: string, manifest: SiteManifest) {
  validateCollectionDefinitions(
    Object.entries(manifest.collections).map(([key, def]) => ({
      key,
      fields: def.fields,
    })),
  )
  const existingSite = (
    await db.select().from(site).where(eq(site.id, siteId)).limit(1)
  ).at(0)
  if (!existingSite) {
    throw new NotFoundError(m.server_site_not_found())
  }

  const keys = Object.keys(manifest.collections)
  const now = new Date()

  await db.transaction(async (tx) => {
    for (const [key, def] of Object.entries(manifest.collections)) {
      await tx
        .insert(collection)
        .values({
          siteId,
          key,
          label: def.label ?? key,
          routePattern: def.route,
          fields: withRequiredSlugField(def.fields),
          enabled: true,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [collection.siteId, collection.key],
          set: {
            label: def.label ?? key,
            routePattern: def.route,
            fields: withRequiredSlugField(def.fields),
            enabled: true,
            updatedAt: now,
          },
        })
    }

    if (keys.length === 0) {
      await tx
        .update(collection)
        .set({ enabled: false, updatedAt: now })
        .where(eq(collection.siteId, siteId))
    } else {
      await tx
        .update(collection)
        .set({ enabled: false, updatedAt: now })
        .where(
          and(eq(collection.siteId, siteId), notInArray(collection.key, keys)),
        )
    }

    await tx
      .update(site)
      .set({ lastManifest: manifest, updatedAt: now })
      .where(eq(site.id, siteId))
  })

  await audit({
    organizationId: existingSite.organizationId,
    siteId,
    action: 'manifest.sync',
    targetType: 'site',
    targetId: siteId,
  })
}

export async function upsertCollection(
  siteId: string,
  input: {
    key: string
    label: string
    routePattern: string
    fields: Field[]
    enabled?: boolean
  },
  actorId?: string,
) {
  validateCollectionDefinitions([input])
  const label = input.label.trim()
  if (!label) {
    throw new ValidationError([{ path: 'label', message: m.server_required() }])
  }
  const invalidField = input.fields.find(
    (field) => !field.key.trim() || !field.label.trim(),
  )
  if (invalidField) {
    throw new ValidationError([
      {
        path: `fields.${input.fields.indexOf(invalidField)}`,
        message: m.server_required(),
      },
    ])
  }
  const fields = withRequiredSlugField(input.fields)
  const existingSite = (
    await db.select().from(site).where(eq(site.id, siteId)).limit(1)
  ).at(0)
  if (!existingSite) {
    throw new NotFoundError(m.server_site_not_found())
  }

  const now = new Date()
  const enabled = input.enabled ?? true

  await db
    .insert(collection)
    .values({
      siteId,
      key: input.key,
      label,
      routePattern: input.routePattern,
      fields,
      enabled,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [collection.siteId, collection.key],
      set: {
        label,
        routePattern: input.routePattern,
        fields,
        enabled,
        updatedAt: now,
      },
    })

  const row = await getCollection(siteId, input.key)
  if (!row) {
    throw new Error(m.server_failed_to_upsert_collection())
  }

  await audit({
    organizationId: existingSite.organizationId,
    siteId,
    actorId,
    action: 'collection.upsert',
    targetType: 'collection',
    targetId: row.id,
    meta: { key: input.key },
  })

  return row
}

export async function deleteCollection(
  siteId: string,
  key: string,
  actorId: string,
) {
  const existing = (
    await db
      .select({
        id: collection.id,
        key: collection.key,
        organizationId: site.organizationId,
      })
      .from(collection)
      .innerJoin(site, eq(collection.siteId, site.id))
      .where(and(eq(collection.siteId, siteId), eq(collection.key, key)))
      .limit(1)
  ).at(0)

  if (!existing) {
    throw new NotFoundError(m.server_collection_not_found())
  }

  await audit({
    organizationId: existing.organizationId,
    siteId,
    actorId,
    action: 'collection.delete',
    targetType: 'collection',
    targetId: existing.id,
    meta: { key: existing.key },
  })

  await db.transaction(async (tx) => {
    await archiveDeletedContent(
      tx,
      existing.organizationId,
      'collection',
      existing.id,
    )
    await tx.delete(collection).where(eq(collection.id, existing.id))
  })
}

function validateCollectionDefinitions(
  defs: { key: string; fields: Field[] }[],
) {
  const issues: { path: string; message: string }[] = []
  for (const def of defs) {
    if (!isSafeIdentifier(def.key))
      issues.push({ path: def.key, message: 'Unsafe collection identifier' })
    const keys = new Set<string>()
    for (const field of def.fields) {
      if (!isSafeIdentifier(field.key) || keys.has(field.key))
        issues.push({
          path: `${def.key}.${field.key}`,
          message: 'Unsafe or duplicate field identifier',
        })
      keys.add(field.key)
      for (const reference of [field.collection, field.after]) {
        if (reference !== undefined && !isSafeIdentifier(reference))
          issues.push({
            path: `${def.key}.${field.key}`,
            message: 'Unsafe field reference identifier',
          })
      }
    }
  }
  if (issues.length) throw new ValidationError(issues)
}
