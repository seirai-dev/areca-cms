import { and, eq, sql } from 'drizzle-orm'

import { db } from '#/db'
import { collection, entry } from '#/db/schema'
import { I18N_KEY } from '#/lib/content-locale'
import type { EntryData, Field } from '#/lib/types'
import { m } from '#/paraglide/messages'

import { ValidationError } from './errors.ts'

/**
 * Field keys are the only identity a field has: a schema save sends the whole
 * list and nothing ties a field to its old key. A key that has content is
 * therefore locked. Dropping it (or renaming it, which is dropping plus adding)
 * deletes that content, so the save must confirm it by key.
 */

type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0]

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Entries of one collection or section that hold a value for each field key,
 * in any stored version (draft, live, scheduled) and in any language. A blank
 * value (empty text, null, an empty list or object) is not content.
 */
export async function fieldKeyUsage(
  executor: Pick<typeof db, 'execute'>,
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
  tx: DbTx,
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

/** Removes the keys from every stored version of the entries, including translations. */
function withoutKeys(data: EntryData, keys: string[]): EntryData {
  const next: EntryData = { ...data }
  for (const key of keys) delete next[key]
  const translations = next[I18N_KEY]
  if (isPlainObject(translations)) {
    next[I18N_KEY] = Object.fromEntries(
      Object.entries(translations).map(([locale, values]) => [
        locale,
        isPlainObject(values)
          ? Object.fromEntries(
              Object.entries(values).filter(([key]) => !keys.includes(key)),
            )
          : values,
      ]),
    )
  }
  return next
}

function holdsAnyKey(data: EntryData | null, keys: string[]): boolean {
  if (!data) return false
  if (keys.some((key) => Object.hasOwn(data, key))) return true
  const translations = data[I18N_KEY]
  return (
    isPlainObject(translations) &&
    Object.values(translations).some(
      (values) =>
        isPlainObject(values) && keys.some((key) => Object.hasOwn(values, key)),
    )
  )
}

/** Deletes the content of the given keys from the collection's entries. */
export async function purgeFieldContent(
  tx: DbTx,
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
        holdsAnyKey(data, keys),
      )
    ) {
      continue
    }
    // A new draft version: an editor still holding the removed field conflicts
    // instead of saving the content back.
    await tx
      .update(entry)
      .set({
        draftVersion: sql`${entry.draftVersion} + 1`,
        draftData: withoutKeys(row.draftData, keys),
        publishedData: row.publishedData
          ? withoutKeys(row.publishedData, keys)
          : row.publishedData,
        scheduledData: row.scheduledData
          ? withoutKeys(row.scheduledData, keys)
          : row.scheduledData,
      })
      .where(eq(entry.id, row.id))
  }
}
