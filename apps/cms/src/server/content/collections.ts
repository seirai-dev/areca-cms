import { archiveDeletedContent } from './deletion-archive'
import { and, eq, notInArray } from 'drizzle-orm'

import { db } from '#/db'
import type { DbReader, Tx } from '#/db'
import { collection, site } from '#/db/schema'
import type { Field, SiteManifest } from '#/lib/types'
import { withRequiredSlugField } from '#/lib/collection-fields'
import { m } from '#/paraglide/messages'
import { audit } from '#/server/audit'
import { applySiteLanguages } from '#/server/admin/site-languages'

import {
  assertKindsUnchanged,
  assertPreviewPath,
  validateContentDefinitions,
} from './content-definitions.ts'
import type { WriteOptions } from './content-definitions.ts'
import {
  confirmedFieldDrops,
  planManifestFieldDrops,
  purgeFieldContent,
} from './field-data.ts'
import { lockSiteLinkIndex } from './entry-link-index.ts'
import { ensureGlobalEntry } from './globals.ts'
import { normalizeRequiredLanguages } from './locale-validation.ts'
import { NotFoundError, ValidationError } from './errors.ts'
import { getSiteOrThrow } from './site-core.ts'

export async function listCollections(
  siteId: string,
  options: { enabledOnly?: boolean } = {},
  connection: DbReader = db,
) {
  const filters = [
    eq(collection.siteId, siteId),
    eq(collection.kind, 'collection'),
  ]
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

export async function getCollection(
  siteId: string,
  key: string,
  connection: DbReader = db,
) {
  const row = (
    await connection
      .select()
      .from(collection)
      .where(
        and(
          eq(collection.siteId, siteId),
          eq(collection.key, key),
          eq(collection.kind, 'collection'),
        ),
      )
      .limit(1)
  ).at(0)
  return row ? { ...row, fields: withRequiredSlugField(row.fields) } : null
}

export async function syncManifest(
  siteId: string,
  manifest: SiteManifest,
  options: {
    /** Field removals the push confirms, as `<collection or section key>.<field key>`. */
    confirmDropFields?: string[]
  } = {},
) {
  const globals = manifest.globals ?? {}
  const keys = Object.keys(manifest.collections)
  const globalKeys = Object.keys(globals)
  const declaredKeys = new Set([...keys, ...globalKeys])
  const declaredDefs = [
    ...Object.entries(manifest.collections).map(([key, def]) => ({
      key,
      kind: 'collection' as const,
      fields: def.fields,
      enabled: true,
    })),
    ...Object.entries(globals).map(([key, def]) => ({
      key,
      kind: 'global' as const,
      fields: def.fields,
      enabled: true,
    })),
  ]
  validateContentDefinitions(declaredDefs)
  for (const [key, def] of Object.entries(globals)) {
    assertPreviewPath(def.previewPath, key)
  }
  const existingSite = await getSiteOrThrow(siteId)

  const now = new Date()

  await db.transaction(async (tx) => {
    await lockSiteLinkIndex(tx, siteId)
    // NO KEY UPDATE, not FOR UPDATE: entries' foreign keys to the site need KEY
    // SHARE, which FOR UPDATE blocks, so a save that holds an entry row would
    // wait on this push while this push waits on that row (see
    // `lockSiteLinkIndex`). NO KEY UPDATE still conflicts with FOR UPDATE, so
    // publishing (publishing/worker.ts) and the scheduler (scheduler.ts) still
    // wait for a manifest push, as before.
    await tx
      .select({ id: site.id })
      .from(site)
      .where(eq(site.id, siteId))
      .for('no key update')
    // Omitted languages leave the site's setting alone.
    if (manifest.languages) {
      await applySiteLanguages(tx, siteId, manifest.languages)
    }
    const existing = await tx
      .select()
      .from(collection)
      .where(eq(collection.siteId, siteId))
    assertKindsUnchanged(existing, declaredDefs)
    validateContentDefinitions([
      ...existing
        .filter((row) => !declaredKeys.has(row.key))
        .map((row) => ({ ...row, enabled: false })),
      ...declaredDefs,
    ])
    // Refuses a removal that would delete content before anything is written.
    const purge = await planManifestFieldDrops(tx, {
      existing,
      declared: declaredDefs.map((def) => ({
        key: def.key,
        kind: def.kind,
        fields:
          def.kind === 'collection'
            ? withRequiredSlugField(def.fields)
            : def.fields,
      })),
      confirmDropFields: options.confirmDropFields,
    })
    for (const [collectionId, fieldKeys] of purge) {
      await purgeFieldContent(tx, collectionId, fieldKeys)
    }
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
          requiredLanguages: normalizeRequiredLanguages(
            def.requiredLanguages ?? [],
          ),
          localizedRoutes: def.routes ?? null,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [collection.siteId, collection.key],
          set: {
            label: def.label ?? key,
            routePattern: def.route,
            fields: withRequiredSlugField(def.fields),
            enabled: true,
            requiredLanguages: normalizeRequiredLanguages(
              def.requiredLanguages ?? [],
            ),
            localizedRoutes: def.routes ?? null,
            updatedAt: now,
          },
        })
    }
    for (const [key, def] of Object.entries(globals)) {
      const row = (
        await tx
          .insert(collection)
          .values({
            siteId,
            key,
            label: def.label ?? key,
            routePattern: '',
            kind: 'global',
            fields: def.fields,
            enabled: true,
            seoEnabled: def.seo ?? false,
            previewPath: def.previewPath ?? null,
            requiredLanguages: normalizeRequiredLanguages(
              def.requiredLanguages ?? [],
            ),
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [collection.siteId, collection.key],
            set: {
              label: def.label ?? key,
              fields: def.fields,
              enabled: true,
              seoEnabled: def.seo ?? false,
              previewPath: def.previewPath ?? null,
              requiredLanguages: normalizeRequiredLanguages(
                def.requiredLanguages ?? [],
              ),
              updatedAt: now,
            },
          })
          .returning({ id: collection.id })
      ).at(0)
      if (!row) {
        throw new Error(m.server_failed_to_upsert_collection())
      }
      await ensureGlobalEntry(tx, siteId, row.id)
    }

    // A push disables what it does not declare. Content is kept.
    await tx
      .update(collection)
      .set({ enabled: false, updatedAt: now })
      .where(
        and(
          eq(collection.siteId, siteId),
          eq(collection.kind, 'collection'),
          ...(keys.length > 0 ? [notInArray(collection.key, keys)] : []),
        ),
      )
    await tx
      .update(collection)
      .set({ enabled: false, updatedAt: now })
      .where(
        and(
          eq(collection.siteId, siteId),
          eq(collection.kind, 'global'),
          ...(globalKeys.length > 0
            ? [notInArray(collection.key, globalKeys)]
            : []),
        ),
      )

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

export type CollectionUpsertInput = {
  key: string
  label: string
  routePattern: string
  fields: Field[]
  enabled?: boolean
  /** Languages besides main that must be complete. Left unchanged when omitted. */
  requiredLanguages?: string[]
  /** Per-language route patterns. Left unchanged when omitted; null clears them. */
  localizedRoutes?: Record<string, string> | null
  /** Keys of fields that are removed together with their content. */
  confirmDropFields?: string[]
}

export type PreparedCollectionUpsert = {
  label: string
  fields: Field[]
  enabled: boolean
}

/** Checks a collection save before anything is written, and returns what to store. */
export function prepareCollectionUpsert(
  input: CollectionUpsertInput,
): PreparedCollectionUpsert {
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
  return {
    label,
    fields: withRequiredSlugField(input.fields),
    enabled: input.enabled ?? true,
  }
}

/**
 * Writes a collection save inside an open transaction. The caller holds the
 * site row lock. Used by the editor's save and by the development-environment
 * push, which runs many of these in one transaction.
 */
export async function writeCollectionUpsert(
  tx: Tx,
  siteId: string,
  input: CollectionUpsertInput,
  prepared: PreparedCollectionUpsert,
  now: Date = new Date(),
  options: WriteOptions = {},
) {
  const { label, fields, enabled } = prepared
  const existing = await tx
    .select()
    .from(collection)
    .where(eq(collection.siteId, siteId))
  assertKindsUnchanged(existing, [{ key: input.key, kind: 'collection' }])
  if (!options.validated) {
    validateContentDefinitions([
      ...existing.filter((row) => row.key !== input.key),
      { key: input.key, kind: 'collection', fields, enabled },
    ])
  }
  const previous = existing.find((row) => row.key === input.key)
  const purgedKeys = await confirmedFieldDrops(tx, {
    collectionId: previous?.id,
    before: previous?.fields ?? [],
    after: fields,
    confirmDropFields: input.confirmDropFields,
  })
  await tx
    .insert(collection)
    .values({
      siteId,
      key: input.key,
      label,
      routePattern: input.routePattern,
      fields,
      enabled,
      requiredLanguages: normalizeRequiredLanguages(
        input.requiredLanguages ?? [],
      ),
      localizedRoutes: input.localizedRoutes ?? null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [collection.siteId, collection.key],
      set: {
        label,
        routePattern: input.routePattern,
        fields,
        enabled,
        ...(input.requiredLanguages !== undefined
          ? {
              requiredLanguages: normalizeRequiredLanguages(
                input.requiredLanguages,
              ),
            }
          : {}),
        ...(input.localizedRoutes !== undefined
          ? { localizedRoutes: input.localizedRoutes }
          : {}),
        updatedAt: now,
      },
    })
  if (previous) await purgeFieldContent(tx, previous.id, purgedKeys)
}

export async function upsertCollection(
  siteId: string,
  input: CollectionUpsertInput,
  actorId?: string,
) {
  const prepared = prepareCollectionUpsert(input)
  const existingSite = await getSiteOrThrow(siteId)

  const now = new Date()

  await db.transaction(async (tx) => {
    await lockSiteLinkIndex(tx, siteId)
    await tx
      .select({ id: site.id })
      .from(site)
      .where(eq(site.id, siteId))
      .for('update')
    await writeCollectionUpsert(tx, siteId, input, prepared, now)
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
      .where(
        and(
          eq(collection.siteId, siteId),
          eq(collection.key, key),
          eq(collection.kind, 'collection'),
        ),
      )
      .limit(1)
  ).at(0)

  if (!existing) {
    throw new NotFoundError(m.server_collection_not_found())
  }

  await db.transaction(async (tx) => {
    await lockSiteLinkIndex(tx, siteId)
    await tx
      .select({ id: site.id })
      .from(site)
      .where(eq(site.id, siteId))
      .for('update')
    await writeCollectionDelete(tx, siteId, existing, actorId)
  })
}

/**
 * Deletes a collection and archives its content, inside an open transaction
 * (the caller holds the site row lock). Audited in the same transaction.
 */
export async function writeCollectionDelete(
  tx: Tx,
  siteId: string,
  existing: { id: string; key: string; organizationId: string },
  actorId: string,
) {
  const remaining = await tx
    .select()
    .from(collection)
    .where(eq(collection.siteId, siteId))
  validateContentDefinitions(remaining.filter((row) => row.id !== existing.id))
  await archiveDeletedContent(
    tx,
    existing.organizationId,
    'collection',
    existing.id,
  )
  await tx.delete(collection).where(eq(collection.id, existing.id))
  await audit(
    {
      organizationId: existing.organizationId,
      siteId,
      actorId,
      action: 'collection.delete',
      targetType: 'collection',
      targetId: existing.id,
      meta: { key: existing.key },
    },
    tx,
  )
}
