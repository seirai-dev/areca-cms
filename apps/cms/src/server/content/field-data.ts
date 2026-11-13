import { and, eq, sql } from 'drizzle-orm'

import { db } from '#/db'
import type { DbExecutor, Tx } from '#/db'
import { collection, entry } from '#/db/schema'
import { holdsAnyFieldKey, withoutFieldKeys } from '#/lib/field-content'
import type { Field } from '#/lib/types'
import { m } from '#/paraglide/messages'

import { ValidationError } from './errors.ts'
import { syncEntryLinkIndex } from './entry-link-index.ts'

/**
 * Field keys are the only identity a field has: a schema save sends the whole
 * list and nothing ties a field to its old key. A key that has content is
 * therefore locked. Dropping it (or renaming it, which is dropping plus adding)
 * deletes that content, so the save must confirm it by key.
 */

/**
 * Entries of one collection or section that hold a value for each field key,
 * in any stored version (draft, live, scheduled) and in any language. A blank
 * value (empty text, null, an empty list or object) is not content.
 */
export async function fieldKeyUsage(
  executor: DbExecutor,
  collectionId: string,
): Promise<Record<string, number>> {
  const result = await executor.execute<{ key: string; entries: number }>(sql`
    select f.key, count(distinct e.id)::int as entries
    from entry e
    cross join lateral (
      values (e.draft_data), (e.published_data), (e.scheduled_data)
    ) as v(data)
    cross join lateral (
      select kv.key, kv.value
      from jsonb_each(
        case when jsonb_typeof(v.data) = 'object' then v.data else '{}'::jsonb end
      ) as kv
      union all
      select tv.key, tv.value
      from jsonb_each(
        case when jsonb_typeof(v.data -> '$i18n') = 'object'
          then v.data -> '$i18n' else '{}'::jsonb end
      ) as loc
      cross join lateral jsonb_each(
        case when jsonb_typeof(loc.value) = 'object' then loc.value else '{}'::jsonb end
      ) as tv
    ) as f
    where e.collection_id = ${collectionId}
      and f.value not in ('null'::jsonb, '""'::jsonb, '[]'::jsonb, '{}'::jsonb)
      and not (jsonb_typeof(f.value) = 'string' and btrim(f.value #>> '{}') = '')
    group by f.key
  `)
  return Object.fromEntries(
    result.rows.map((row) => [row.key, Number(row.entries)]),
  )
}

/** Per-key content counts of a collection or section, by its key in the site. */
export async function fieldDataUsageForCollection(
  siteId: string,
  key: string,
): Promise<Record<string, number>> {
  const row = (
    await db
      .select({ id: collection.id })
      .from(collection)
      .where(and(eq(collection.siteId, siteId), eq(collection.key, key)))
      .limit(1)
  ).at(0)
  return row ? fieldKeyUsage(db, row.id) : {}
}

/** Keys the new field list no longer declares. */
export function droppedFieldKeys(before: Field[], after: Field[]): string[] {
  const kept = new Set(after.map((field) => field.key))
  return before.map((field) => field.key).filter((key) => !kept.has(key))
}

/**
 * Checks a schema save against the content it would delete. Returns the
 * dropped keys that hold content and were confirmed, so the caller can purge
 * them. Throws a validation error naming every unconfirmed key.
 */
export async function confirmedFieldDrops(
  tx: Tx,
  input: {
    collectionId: string | undefined
    before: Field[]
    after: Field[]
    confirmDropFields?: string[]
  },
): Promise<string[]> {
  if (!input.collectionId) return []
  const dropped = droppedFieldKeys(input.before, input.after)
  if (dropped.length === 0) return []
  const usage = await fieldKeyUsage(tx, input.collectionId)
  const withContent = dropped.filter((key) => (usage[key] ?? 0) > 0)
  const confirmed = new Set(input.confirmDropFields ?? [])
  const unconfirmed = withContent.filter((key) => !confirmed.has(key))
  if (unconfirmed.length > 0) {
    throw new ValidationError(
      unconfirmed.map((key) => ({
        path: 'fields',
        message:
          usage[key] === 1
            ? m.server_field_has_content_one({ key })
            : m.server_field_has_content_other({ key, count: usage[key] }),
      })),
    )
  }
  return withContent
}

/** A field a schema push would remove while entries still hold content for it. */
export type FieldDrop = {
  kind: 'collection' | 'global'
  /** Raw CMS key of the collection or site content section. */
  key: string
  /** Raw field key. */
  field: string
  /** Entries that hold content for the field, in any version or language. */
  entries: number
}

/** Confirmation id of a field drop in a manifest push: `<key>.<field>`. Identifiers never hold a dot. */
export function fieldDropId(drop: { key: string; field: string }): string {
  return `${drop.key}.${drop.field}`
}

/** A manifest push refused because it would delete content it did not confirm. Nothing was written. */
export class FieldDropsUnconfirmedError extends Error {
  readonly drops: FieldDrop[]

  constructor(drops: FieldDrop[]) {
    super(
      `Removing ${drops.map(fieldDropId).join(', ')} deletes content. Confirm each removal to push the schema.`,
    )
    this.name = 'FieldDropsUnconfirmedError'
    this.drops = drops
  }
}

/**
 * Checks a manifest push against the content it would delete, before anything
 * is written. A dropped field that holds content is only allowed when the push
 * confirms it as `<key>.<field>`; otherwise the push is refused with every
 * unconfirmed drop. Returns the confirmed keys to purge, per collection id.
 */
export async function planManifestFieldDrops(
  tx: Tx,
  input: {
    existing: {
      id: string
      key: string
      kind: 'collection' | 'global'
      fields: Field[]
    }[]
    declared: { key: string; kind: 'collection' | 'global'; fields: Field[] }[]
    confirmDropFields?: string[]
  },
): Promise<Map<string, string[]>> {
  const confirmed = new Set(input.confirmDropFields ?? [])
  const unconfirmed: FieldDrop[] = []
  const purge = new Map<string, string[]>()
  for (const def of input.declared) {
    const previous = input.existing.find(
      (row) => row.key === def.key && row.kind === def.kind,
    )
    if (!previous) continue
    const dropped = droppedFieldKeys(previous.fields, def.fields)
    if (dropped.length === 0) continue
    const usage = await fieldKeyUsage(tx, previous.id)
    for (const field of dropped) {
      const entries = usage[field] ?? 0
      if (entries === 0) continue
      const drop = { kind: def.kind, key: def.key, field, entries }
      if (confirmed.has(fieldDropId(drop))) {
        purge.set(previous.id, [...(purge.get(previous.id) ?? []), field])
      } else {
        unconfirmed.push(drop)
      }
    }
  }
  if (unconfirmed.length > 0) throw new FieldDropsUnconfirmedError(unconfirmed)
  return purge
}

/** Deletes the content of the given keys from the collection's entries. */
export async function purgeFieldContent(
  tx: Tx,
  collectionId: string,
  keys: string[],
): Promise<void> {
  if (keys.length === 0) return
  const rows = await tx
    .select({
      id: entry.id,
      draftData: entry.draftData,
      publishedData: entry.publishedData,
      scheduledData: entry.scheduledData,
    })
    .from(entry)
    .where(eq(entry.collectionId, collectionId))
  for (const row of rows) {
    if (
      ![row.draftData, row.publishedData, row.scheduledData].some((data) =>
        holdsAnyFieldKey(data, keys),
      )
    ) {
      continue
    }
    // A new draft version: an editor still holding the removed field conflicts
    // instead of saving the content back.
    await tx
      .update(entry)
      .set({
        contentVersion: sql`${entry.contentVersion} + 1`,
        draftVersion: sql`${entry.draftVersion} + 1`,
        draftData: withoutFieldKeys(row.draftData, keys),
        publishedData: row.publishedData
          ? withoutFieldKeys(row.publishedData, keys)
          : row.publishedData,
        scheduledData: row.scheduledData
          ? withoutFieldKeys(row.scheduledData, keys)
          : row.scheduledData,
      })
      .where(eq(entry.id, row.id))
    await syncEntryLinkIndex(tx, row.id)
  }
}
