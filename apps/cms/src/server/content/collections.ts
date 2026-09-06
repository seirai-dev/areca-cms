import { and, eq, notInArray } from 'drizzle-orm'

import { db } from '#/db'
import { collection, site } from '#/db/schema'
import type { Field, SiteManifest } from '#/lib/types'
import { audit } from '#/server/audit'

import { NotFoundError } from './errors.ts'

export async function listCollections(
  siteId: string,
  options: { enabledOnly?: boolean } = {},
) {
  const filters = [eq(collection.siteId, siteId)]
  if (options.enabledOnly) {
    filters.push(eq(collection.enabled, true))
  }
  return db
    .select()
    .from(collection)
    .where(and(...filters))
    .orderBy(collection.key)
}

export async function getCollection(siteId: string, key: string) {
  const [row] = await db
    .select()
    .from(collection)
    .where(and(eq(collection.siteId, siteId), eq(collection.key, key)))
    .limit(1)
  return row ?? null
}

export async function syncManifest(siteId: string, manifest: SiteManifest) {
  const [existingSite] = await db
    .select()
    .from(site)
    .where(eq(site.id, siteId))
    .limit(1)
  if (!existingSite) {
    throw new NotFoundError('Site not found')
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
          fields: def.fields,
          enabled: true,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [collection.siteId, collection.key],
          set: {
            label: def.label ?? key,
            routePattern: def.route,
            fields: def.fields,
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
          and(
            eq(collection.siteId, siteId),
            notInArray(collection.key, keys),
          ),
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
) {
  const [existingSite] = await db
    .select()
    .from(site)
    .where(eq(site.id, siteId))
    .limit(1)
  if (!existingSite) {
    throw new NotFoundError('Site not found')
  }

  const now = new Date()
  const enabled = input.enabled ?? true

  await db
    .insert(collection)
    .values({
      siteId,
      key: input.key,
      label: input.label,
      routePattern: input.routePattern,
      fields: input.fields,
      enabled,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [collection.siteId, collection.key],
      set: {
        label: input.label,
        routePattern: input.routePattern,
        fields: input.fields,
        enabled,
        updatedAt: now,
      },
    })

  const row = await getCollection(siteId, input.key)
  if (!row) {
    throw new Error('Failed to upsert collection')
  }

  await audit({
    organizationId: existingSite.organizationId,
    siteId,
    action: 'collection.upsert',
    targetType: 'collection',
    targetId: row.id,
    meta: { key: input.key },
  })

  return row
}
