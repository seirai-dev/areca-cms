/** The schema, language and schema-baseline steps of a push. */
import { and, eq, sql } from 'drizzle-orm'

import { collection, entry, site } from '#/db/schema'
import type {
  SchemaSnapshot,
  SchemaSnapshotItem,
  SiteLanguages,
} from '#/lib/types'
import { applySiteLanguages } from '#/server/admin/site-languages'
import { archiveDeletedContent } from '#/server/content/deletion-archive'
import {
  prepareCollectionUpsert,
  writeCollectionUpsert,
} from '#/server/content/collections'
import type { CollectionUpsertInput } from '#/server/content/collections'
import {
  assertKindsUnchanged,
  validateContentDefinitions,
} from '#/server/content/content-definitions'
import type { ContentDefinition } from '#/server/content/content-definitions'
import { archivedColumns } from '#/server/content/entry-commit'
import { ValidationError } from '#/server/content/errors'
import {
  prepareGlobalUpsert,
  writeGlobalUpsert,
} from '#/server/content/globals'
import type { GlobalInput } from '#/server/content/globals'

import type { PlanInput, PlanItem } from './plan'
import type { PushState } from './push-state'

/**
 * The production schema as it will be after the selected schema items, checked
 * once before any write, so the order of the items does not matter (a new
 * collection may reference one that sorts after it). Untouched definitions
 * stay as they are; an applied removal is disabled, and keeps its rows.
 */
export function checkResultingSchema(planInput: PlanInput, items: PlanItem[]) {
  const itemByKey = new Map(
    items.map((item) => [item.collectionKey ?? '', item]),
  )
  const production = planInput.production.collections
  const keys = [
    ...new Set([...production.map((def) => def.key), ...itemByKey.keys()]),
  ]
  const defs: ContentDefinition[] = []
  const declared: { key: string; kind: ContentDefinition['kind'] }[] = []
  for (const key of keys) {
    const item = itemByKey.get(key)
    const prod = production.find((def) => def.key === key)
    if (item?.kind === 'schema.remove') {
      if (prod) {
        defs.push({ key, kind: prod.kind, fields: prod.fields, enabled: false })
      }
      continue
    }
    if (item) {
      const dev = planInput.dev.collections.find((def) => def.key === key)
      if (!dev) {
        throw new ValidationError([
          { path: key, message: `Collection "${key}" is not in the dev env.` },
        ])
      }
      // The same checks and stored shape the writes use (a collection gets its slug field).
      let fields = dev.fields
      if (dev.kind === 'global') {
        prepareGlobalUpsert(globalInput(dev, []))
      } else {
        fields = prepareCollectionUpsert(collectionInput(dev, [])).fields
      }
      defs.push({ key, kind: dev.kind, fields, enabled: dev.enabled })
      declared.push({ key, kind: dev.kind })
      continue
    }
    if (prod) {
      defs.push({
        key,
        kind: prod.kind,
        fields: prod.fields,
        enabled: prod.enabled,
      })
    }
  }
  assertKindsUnchanged(production, declared)
  validateContentDefinitions(defs)
}

export async function pushSchema(state: PushState, items: PlanItem[]) {
  const { tx, production } = state
  // Adds and changes first, so a removal never leaves a reference dangling mid-push.
  const ordered = [
    ...items.filter((item) => item.kind !== 'schema.remove'),
    ...items.filter((item) => item.kind === 'schema.remove'),
  ]
  for (const item of ordered) {
    const key = item.collectionKey ?? ''
    const existing = (
      await tx
        .select({ id: collection.id })
        .from(collection)
        .where(
          and(eq(collection.siteId, production.id), eq(collection.key, key)),
        )
        .limit(1)
    ).at(0)

    if (item.kind === 'schema.remove') {
      // Disabled and archived, never deleted: production keeps the rows.
      if (existing) await disableAndArchive(state, existing.id)
      continue
    }

    const devDef = state.planInput.dev.collections.find(
      (def) => def.key === key,
    )
    if (!devDef) {
      throw new ValidationError([
        { path: key, message: `Collection "${key}" is not in the dev env.` },
      ])
    }
    const confirmDropFields = (item.summary.droppedFields ?? []).map(
      (drop) => drop.key,
    )
    // A dropped field's content is archived with the collection before it is purged.
    if (confirmDropFields.length > 0 && existing) {
      await archiveDeletedContent(
        tx,
        state.organizationId,
        'collection',
        existing.id,
      )
    }
    // The resulting schema was validated once in checkResultingSchema.
    if (devDef.kind === 'global') {
      const input = globalInput(devDef, confirmDropFields)
      await writeGlobalUpsert(
        tx,
        production.id,
        input,
        prepareGlobalUpsert(input),
        new Date(),
        { validated: true },
      )
    } else {
      const input = collectionInput(devDef, confirmDropFields)
      await writeCollectionUpsert(
        tx,
        production.id,
        input,
        prepareCollectionUpsert(input),
        new Date(),
        { validated: true },
      )
    }
  }
}

/**
 * A removal in dev disables the production collection or section and archives
 * its entries (status archived, content_version bumped). Rows are kept. The
 * baseline drops the key, and a disabled production collection counts as absent
 * in the plan, so the removal does not come back.
 */
async function disableAndArchive(state: PushState, collectionId: string) {
  const { tx, actor } = state
  const now = new Date()
  await tx
    .update(collection)
    .set({ enabled: false, updatedAt: now })
    .where(eq(collection.id, collectionId))
  await tx
    .update(entry)
    .set({
      contentVersion: sql`${entry.contentVersion} + 1`,
      ...archivedColumns(actor.id, now),
    })
    .where(eq(entry.collectionId, collectionId))
}

function globalInput(
  def: SchemaSnapshotItem,
  confirmDropFields: string[],
): GlobalInput {
  return {
    key: def.key,
    label: def.label,
    fields: def.fields,
    seo: def.seoEnabled,
    previewPath: def.previewPath,
    enabled: def.enabled,
    requiredLanguages: def.requiredLanguages,
    confirmDropFields,
  }
}

function collectionInput(
  def: SchemaSnapshotItem,
  confirmDropFields: string[],
): CollectionUpsertInput {
  return {
    key: def.key,
    label: def.label,
    routePattern: def.routePattern,
    fields: def.fields,
    enabled: def.enabled,
    requiredLanguages: def.requiredLanguages,
    localizedRoutes: def.localizedRoutes,
    confirmDropFields,
  }
}

export async function pushLanguages(state: PushState) {
  const languages: SiteLanguages | null = state.planInput.dev.languages
  if (!languages) return
  await applySiteLanguages(
    state.tx,
    state.production.id,
    { main: languages.main, all: languages.all },
    state.actor.id,
  )
}

/**
 * Schema baseline, per item: applied schema items take the dev definition (or
 * leave the baseline when removed), skipped ones keep the old one, so they
 * stay listed. Languages move only when they were applied.
 */
export async function writeSchemaBaseline(
  state: PushState,
  selected: PlanItem[],
  planInput: PlanInput,
  devSiteId: string,
) {
  const { tx } = state
  const base: SchemaSnapshot = planInput.base ?? {
    languages: null,
    collections: [],
  }
  const byKey = new Map(base.collections.map((def) => [def.key, def]))
  for (const item of selected) {
    if (!item.kind.startsWith('schema.') || !item.collectionKey) continue
    if (item.kind === 'schema.remove') {
      byKey.delete(item.collectionKey)
      continue
    }
    const devDef = planInput.dev.collections.find(
      (def) => def.key === item.collectionKey,
    )
    if (devDef) byKey.set(item.collectionKey, devDef)
  }
  const languagesApplied = selected.some((item) => item.kind === 'languages')
  const next: SchemaSnapshot = {
    languages: languagesApplied ? planInput.dev.languages : base.languages,
    collections: [...byKey.values()].sort((a, b) =>
      a.key < b.key ? -1 : a.key > b.key ? 1 : 0,
    ),
  }
  const now = new Date()
  await tx
    .update(site)
    .set({ schemaBaseline: next, lastPushedAt: now, updatedAt: now })
    .where(eq(site.id, devSiteId))
}
