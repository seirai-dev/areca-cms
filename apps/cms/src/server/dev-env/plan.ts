/**
 * Push plan (docs/design/dev-environments.md, "Plan (diff) computation").
 *
 * Pure: takes plain data that `load-plan.ts` reads from the database and
 * returns the items the push screen lists, plus the plan hash that a push must
 * echo back. No database imports, so every rule is unit-tested here.
 */
import { createHash } from 'node:crypto'

import { NEVER_APPLIED_ATTENTION } from '#/lib/dev-env'
import type { PlanAttentionCode, PlanTitleCode } from '#/lib/dev-env'
import {
  holdsAnyFieldKey,
  presentFieldKeys,
  withoutFieldKeys,
} from '#/lib/field-content'
import { I18N_KEY, LOCALE_KEY } from '#/lib/content-locale'
import type {
  ContentKind,
  EntryData,
  EntryOriginBaseline,
  EntryStatus,
  Field,
  SchemaSnapshot,
  SchemaSnapshotItem,
} from '#/lib/types'

import { findSlugCollisions } from './slug-collisions'
import type { SlugCollision, SlugOwner } from './slug-collisions'

export type PlanItemKind =
  | 'schema.add'
  | 'schema.change'
  | 'schema.remove'
  | 'languages'
  | 'entry.new'
  | 'entry.change'
  | 'entry.archive'

/** Why an item needs attention, or null. See `PLAN_ATTENTION_CODES`. */
export type PlanAttention = PlanAttentionCode | null

export type PlanSummary = {
  /** Field keys that differ between the baseline and dev (entries), or whose definition differs (schema). */
  changedFields?: string[]
  readyChanged?: boolean
  draftChanged?: boolean
  /** Fields the item removes that hold production values, with the number of entries holding one. */
  droppedFields?: { key: string; values: number }[]
  /**
   * Entry rows only: fields a pending removal in the schema keeps in production
   * for this entry. They are kept until the removal is applied.
   */
  preservedFields?: string[]
  /** Entries a main-language change stamps in production. */
  stampCount?: number
  /**
   * Schema items only: titles of affected production entries that are
   * scheduled. Such an item cannot be applied until the schedule is resolved.
   */
  scheduledTitles?: string[]
  /**
   * Entry rows only: URLs (main or localized) that another production entry
   * holds, or that another entry in the same push holds. The item cannot be
   * applied until the URL changes in development.
   */
  slugCollisions?: SlugCollision[]
}

export type PlanItem = {
  /** Stable id: `schema:<key>`, `languages`, or `entry:<devId>`. */
  id: string
  kind: PlanItemKind
  /**
   * What the row is about: the entry title, the section or collection label,
   * or the languages label. Display only; not part of the plan hash.
   */
  title: string
  /** Collection label of an entry row. Not set for sections. Display only. */
  collectionLabel?: string
  /** Set when the title is a fixed label the UI translates; `title` stays English. */
  titleCode?: PlanTitleCode
  collectionKey: string | null
  /** Dev entry id, for entry items. */
  devId?: string
  summary: PlanSummary
  devChanged: boolean
  productionChanged: boolean
  attention: PlanAttention
  /** Production entry the item writes to, when it exists. */
  productionId?: string
  /** Production `content_version` the plan saw for that entry. */
  productionContentVersion?: number
  /**
   * Plan item ids this item depends on. An entry whose field removal is pending
   * in the schema depends on that `schema:<key>` item (see `summary.preservedFields`).
   */
  dependsOn?: string[]
  /**
   * Production entries a destructive schema item changes (a removal, or a
   * removal of fields that hold content), with the `content_version` the plan
   * saw. Part of the plan hash; a push verifies them under row locks.
   */
  affectedEntries?: { id: string; contentVersion: number }[]
}

export type Plan = { items: PlanItem[]; planHash: string }

export type PlanEntry = {
  id: string
  collectionKey: string
  collectionKind: ContentKind
  slug: string
  /** Row title the loader computed: the entry title, or the section label for a section. */
  title: string
  status: EntryStatus
  draftData: EntryData
  publishedSlug: string | null
  publishedData: EntryData | null
  originEntryId: string | null
  originBaseline: EntryOriginBaseline | null
  originContentVersion: number | null
}

export type PlanProductionEntry = {
  id: string
  collectionKey: string
  collectionKind: ContentKind
  slug: string
  contentVersion: number
  status: EntryStatus
  /** True when the production entry has a scheduled version. */
  scheduled: boolean
  /** Row title the loader computed (entry title, or section label). Display only. */
  title?: string
  /** Stored versions, for which fields hold content. Optional: absent reads as empty. */
  draftData?: EntryData
  publishedData?: EntryData | null
  scheduledData?: EntryData | null
}

export type PlanInput = {
  /** `site.schema_baseline` of the dev env. Null is treated as an empty schema. */
  base: SchemaSnapshot | null
  dev: SchemaSnapshot
  production: SchemaSnapshot
  devEntries: PlanEntry[]
  productionEntries: PlanProductionEntry[]
  /** Production entries holding a value for each field, by collection key then field key. */
  productionFieldUsage: Record<string, Record<string, number>>
  /** Production entries a main-language change would stamp. */
  stampCount: number
}

const EMPTY_SCHEMA: SchemaSnapshot = { languages: null, collections: [] }

/** Deterministic JSON: object keys sorted, undefined members dropped. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value))
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(source).sort()) {
      if (source[key] === undefined) continue
      out[key] = sortKeys(source[key])
    }
    return out
  }
  return value
}

export function deepEqual(a: unknown, b: unknown): boolean {
  return stableStringify(a) === stableStringify(b)
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

function findByKey<T extends { key: string }>(
  rows: T[],
  key: string,
): T | undefined {
  return rows.find((row) => row.key === key)
}

function uniqueSorted(keys: string[]): string[] {
  return [...new Set(keys)].sort()
}

/** Field keys whose definition differs between two field lists (added, removed or changed). */
function changedFieldKeys(before: Field[], after: Field[]): string[] {
  const keys = uniqueSorted([
    ...before.map((field) => field.key),
    ...after.map((field) => field.key),
  ])
  return keys.filter((key) => {
    const a = before.find((field) => field.key === key)
    const b = after.find((field) => field.key === key)
    return !deepEqual(a, b)
  })
}

/** Top-level keys whose values differ, `$i18n` and `$seo` included as whole keys. */
function changedDataKeys(before: EntryData, after: EntryData): string[] {
  const keys = uniqueSorted([...Object.keys(before), ...Object.keys(after)])
  return keys.filter((key) => !deepEqual(before[key], after[key]))
}

/** Production values of the fields the dev side removes, in field order. */
function droppedFields(
  productionFields: Field[],
  devFields: Field[],
  usage: Record<string, number>,
): { key: string; values: number }[] {
  const kept = new Set(devFields.map((field) => field.key))
  return productionFields
    .filter((field) => !kept.has(field.key))
    .map((field) => ({ key: field.key, values: usage[field.key] ?? 0 }))
    .filter((drop) => drop.values > 0)
}

type Built = {
  item: PlanItem
  /** Values the item was planned from; part of the plan hash. */
  fingerprint: unknown
}

/**
 * Production side of a collection for the plan. A disabled production
 * collection counts as absent when `otherAbsent` (dev or the baseline has no
 * such collection): the removal was pushed (or made in production), so it
 * must not show up again.
 */
function productionSide(
  def: SchemaSnapshotItem | undefined,
  otherAbsent: boolean,
): SchemaSnapshotItem | undefined {
  return otherAbsent && def && def.enabled === false ? undefined : def
}

/** Production entries of one collection or section that a schema change would touch. */
function affectedRows(
  input: PlanInput,
  key: string,
  dropped: string[] | 'all',
): PlanProductionEntry[] {
  return input.productionEntries
    .filter((row) => row.collectionKey === key)
    .filter(
      (row) =>
        dropped === 'all' ||
        holdsAnyFieldKey(row.draftData ?? null, dropped) ||
        holdsAnyFieldKey(row.publishedData ?? null, dropped) ||
        holdsAnyFieldKey(row.scheduledData ?? null, dropped),
    )
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

/**
 * Production rows a main-language stamp rewrites (applySiteLanguages): a row
 * whose draft, ready or scheduled version has no `$locale`. The stamp bumps the
 * version of each such row, so all of them are affected, in id order.
 */
function stampedRows(rows: PlanProductionEntry[]): PlanProductionEntry[] {
  const lacksLocale = (data: EntryData | null | undefined) =>
    !Object.hasOwn(data ?? {}, LOCALE_KEY)
  return rows
    .filter(
      (row) =>
        lacksLocale(row.draftData) ||
        (row.publishedData != null && lacksLocale(row.publishedData)) ||
        (row.scheduledData != null && lacksLocale(row.scheduledData)),
    )
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

function schemaItems(input: PlanInput, base: SchemaSnapshot): Built[] {
  const keys = uniqueSorted([
    ...base.collections.map((def) => def.key),
    ...input.dev.collections.map((def) => def.key),
    ...input.production.collections.map((def) => def.key),
  ])
  const built: Built[] = []
  for (const key of keys) {
    const b = findByKey(base.collections, key)
    const d = findByKey(input.dev.collections, key)
    const pRaw = findByKey(input.production.collections, key)
    if (deepEqual(b, d)) continue

    const p = productionSide(pRaw, d === undefined)
    const kind: PlanItemKind = !b
      ? 'schema.add'
      : !d
        ? 'schema.remove'
        : 'schema.change'
    const productionChanged = !deepEqual(b, p)
    // Dev equal to production leaves nothing to resolve, so it is never a conflict.
    const conflict = productionChanged && !deepEqual(d, p)
    const dropped = droppedFields(
      pRaw?.fields ?? [],
      d?.fields ?? [],
      input.productionFieldUsage[key] ?? {},
    )
    // Turning SEO off on a section strips `$seo` from its production draft, and
    // the write bumps the section's version (globals.ts writeGlobalUpsert).
    const seoStripped =
      kind === 'schema.change' &&
      p?.kind === 'global' &&
      p.seoEnabled &&
      d?.seoEnabled === false
    // A removal archives every production entry of the collection; a field
    // removal purges the entries that hold one of its values; SEO-off rewrites
    // the section's entry.
    const rows =
      kind === 'schema.remove' || seoStripped
        ? affectedRows(input, key, 'all')
        : dropped.length > 0
          ? affectedRows(
              input,
              key,
              dropped.map((drop) => drop.key),
            )
          : []
    const affected = rows.map((row) => ({
      id: row.id,
      contentVersion: row.contentVersion,
    }))
    // A scheduled entry the change would touch blocks it: resolve the schedule first.
    const scheduledTitles = rows
      .filter((row) => row.scheduled)
      .map((row) => row.title ?? row.slug)
    const attention: PlanAttention =
      scheduledTitles.length > 0
        ? 'scheduled'
        : conflict
          ? 'conflict'
          : dropped.length > 0 || (kind === 'schema.remove' && rows.length > 0)
            ? 'drops-content'
            : null
    const def = (d ?? b) as SchemaSnapshotItem
    built.push({
      item: {
        id: `schema:${key}`,
        kind,
        title: def.label,
        collectionKey: key,
        summary: {
          changedFields: changedFieldKeys(b?.fields ?? [], d?.fields ?? []),
          ...(dropped.length > 0 ? { droppedFields: dropped } : {}),
          ...(scheduledTitles.length > 0 ? { scheduledTitles } : {}),
        },
        devChanged: true,
        productionChanged,
        attention,
        ...(affected.length > 0 ? { affectedEntries: affected } : {}),
      },
      fingerprint: { base: b ?? null, dev: d ?? null, prod: p ?? null },
    })
  }
  return built
}

function languageItem(input: PlanInput, base: SchemaSnapshot): Built | null {
  const baseLanguages = base.languages
  const devLanguages = input.dev.languages
  // A site cannot clear its languages, so a dev env with none has no change to push.
  if (devLanguages == null || deepEqual(baseLanguages, devLanguages)) {
    return null
  }
  const productionLanguages = input.production.languages
  const productionChanged = !deepEqual(baseLanguages, productionLanguages)
  // Only a switch of an existing main language stamps data; a first language has nothing to stamp.
  const mainChanged =
    baseLanguages != null && baseLanguages.main !== devLanguages.main
  // The push stamps when production's own main language differs from dev's
  // (applySiteLanguages), so the rows it rewrites are the ones the plan covers.
  const stamps =
    productionLanguages != null &&
    productionLanguages.main !== devLanguages.main
  const stamped = stamps ? stampedRows(input.productionEntries) : []
  const scheduledTitles = stamped
    .filter((row) => row.scheduled)
    .map((row) => row.title ?? row.slug)
  const attention: PlanAttention =
    scheduledTitles.length > 0
      ? 'scheduled'
      : productionChanged && !deepEqual(devLanguages, productionLanguages)
        ? 'conflict'
        : mainChanged
          ? 'main-language'
          : null
  return {
    item: {
      id: 'languages',
      kind: 'languages',
      title: 'Site languages',
      collectionKey: null,
      titleCode: 'site-languages',
      summary: {
        ...(mainChanged ? { stampCount: input.stampCount } : {}),
        ...(scheduledTitles.length > 0 ? { scheduledTitles } : {}),
      },
      devChanged: true,
      productionChanged,
      attention,
      ...(stamped.length > 0
        ? {
            affectedEntries: stamped.map((row) => ({
              id: row.id,
              contentVersion: row.contentVersion,
            })),
          }
        : {}),
    },
    fingerprint: {
      base: baseLanguages,
      dev: devLanguages,
      prod: productionLanguages,
    },
  }
}

/** Whether a dev entry differs from its baseline (or has none). */
function entryChanged(dev: PlanEntry, ignore: string[] = []): boolean {
  const base = dev.originBaseline
  if (!base) return true
  return (
    dev.slug !== base.slug ||
    !deepEqual(
      withoutKeysForCompare(dev.draftData, ignore),
      withoutKeysForCompare(base.data, ignore),
    ) ||
    dev.publishedSlug !== base.publishedSlug ||
    !deepEqual(
      withoutIgnored(dev.publishedData, ignore),
      withoutIgnored(base.publishedData, ignore),
    ) ||
    dev.status !== base.status
  )
}

/** Ready data without the ignored keys; null stays null. */
function withoutIgnored(
  data: EntryData | null,
  ignore: string[],
): EntryData | null {
  return data == null ? null : withoutKeysForCompare(data, ignore)
}

/**
 * `withoutFieldKeys` for comparing two versions of an entry. An empty language
 * slot (left by a removed field, or by the purge of one) and an `$i18n` with no
 * slot count as absent: dev has no slot for a field it removed, so its draft
 * has none either.
 */
function withoutKeysForCompare(data: EntryData, ignore: string[]): EntryData {
  const next = withoutFieldKeys(data, ignore)
  const translations = next[I18N_KEY]
  if (!isPlainObject(translations)) return next
  const slots = Object.entries(translations).filter(
    ([, slot]) => !(isPlainObject(slot) && Object.keys(slot).length === 0),
  )
  const { [I18N_KEY]: _translations, ...rest } = next
  return slots.length > 0
    ? { ...rest, [I18N_KEY]: Object.fromEntries(slots) }
    : rest
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Field keys a production entry holds in any stored version, blank values
 * included: a kept field keeps what production stores, even an empty string.
 */
function heldFieldKeys(prod: PlanProductionEntry): Set<string> {
  return new Set([
    ...presentFieldKeys(prod.draftData),
    ...presentFieldKeys(prod.publishedData),
    ...presentFieldKeys(prod.scheduledData),
  ])
}

/** Field keys production has and dev does not, for one collection (a field removal in dev). */
export function removedFieldKeysOf(
  input: Pick<PlanInput, 'dev' | 'production'>,
  key: string,
): string[] {
  const p = findByKey(input.production.collections, key)
  const d = findByKey(input.dev.collections, key)
  if (!p || !d) return []
  const kept = new Set(d.fields.map((field) => field.key))
  return p.fields.map((field) => field.key).filter((k) => !kept.has(k))
}

/**
 * Fields removed from a collection by a schema change in this plan (in
 * production, not in dev), by collection key.
 */
function removedFieldKeys(
  input: PlanInput,
  schema: Built[],
): Map<string, string[]> {
  const removed = new Map<string, string[]>()
  for (const { item } of schema) {
    if (item.kind !== 'schema.change' || !item.collectionKey) continue
    removed.set(
      item.collectionKey,
      removedFieldKeysOf(input, item.collectionKey),
    )
  }
  return removed
}

function entrySummary(dev: PlanEntry, ignore: string[] = []): PlanSummary {
  const base = dev.originBaseline
  if (!base) {
    return {
      changedFields: Object.keys(dev.draftData),
      draftChanged: true,
      readyChanged: dev.publishedData != null,
    }
  }
  const draft = withoutKeysForCompare(dev.draftData, ignore)
  const baseDraft = withoutKeysForCompare(base.data, ignore)
  const published = withoutIgnored(dev.publishedData, ignore)
  const basePublished = withoutIgnored(base.publishedData, ignore)
  const draftChanged = dev.slug !== base.slug || !deepEqual(draft, baseDraft)
  const readyChanged =
    dev.publishedSlug !== base.publishedSlug ||
    !deepEqual(published, basePublished) ||
    dev.status !== base.status
  const changedFields = uniqueSorted([
    ...changedDataKeys(baseDraft, draft),
    ...changedDataKeys(basePublished ?? {}, published ?? {}),
  ])
  return { changedFields, draftChanged, readyChanged }
}

function entryFingerprint(
  dev: PlanEntry,
  prod: PlanProductionEntry | undefined,
) {
  return {
    base: dev.originBaseline,
    dev: {
      slug: dev.slug,
      draftData: dev.draftData,
      publishedSlug: dev.publishedSlug,
      publishedData: dev.publishedData,
      status: dev.status,
    },
    prod: prod
      ? {
          contentVersion: prod.contentVersion,
          status: prod.status,
          scheduled: prod.scheduled,
        }
      : null,
  }
}

/**
 * Label of the collection a dev entry belongs to. A section has none: its row
 * title is the section label already.
 */
function entryCollectionLabel(
  input: PlanInput,
  dev: PlanEntry,
): string | undefined {
  if (dev.collectionKind === 'global') return undefined
  const defs = [
    ...input.dev.collections,
    ...input.production.collections,
    ...(input.base?.collections ?? []),
  ]
  return (
    defs.find((def) => def.key === dev.collectionKey)?.label ??
    dev.collectionKey
  )
}

function entryItems(
  input: PlanInput,
  addedKeys: Set<string>,
  removed: Map<string, string[]>,
): Built[] {
  const productionById = new Map(
    input.productionEntries.map((row) => [row.id, row]),
  )
  const built: Built[] = []
  const devEntries = [...input.devEntries].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  )
  for (const dev of devEntries) {
    const archive = dev.status === 'archived'

    if (dev.originEntryId != null) {
      const prod = productionById.get(dev.originEntryId)
      // Fields a pending removal keeps in production for this entry. They are not
      // a change: an entry whose only difference is one of them is not listed.
      const held = prod && !archive ? heldFieldKeys(prod) : new Set<string>()
      const preserved = (removed.get(dev.collectionKey) ?? []).filter((key) =>
        held.has(key),
      )
      if (!entryChanged(dev, preserved)) continue
      if (!prod && archive) continue
      const productionChanged =
        !prod || prod.contentVersion !== dev.originContentVersion
      const attention: PlanAttention = !prod
        ? 'deleted-in-production'
        : prod.scheduled
          ? 'scheduled'
          : productionChanged
            ? 'conflict'
            : null
      built.push(
        entryBuilt(dev, prod, {
          kind: archive ? 'entry.archive' : 'entry.change',
          attention,
          productionChanged,
          collectionLabel: entryCollectionLabel(input, dev),
          preservedFields: preserved,
        }),
      )
      continue
    }

    // Dev-created entries (no origin). Archived ones were never published.
    if (archive) continue
    if (dev.collectionKind === 'global') {
      // A section's single entry is created with its section: match it by key.
      const match = input.productionEntries.find(
        (row) =>
          row.collectionKey === dev.collectionKey &&
          row.collectionKind === 'global' &&
          row.slug === dev.slug,
      )
      if (!match && !addedKeys.has(dev.collectionKey)) continue
      // Matched by key, the section was made in dev without a link: production
      // holds a value the dev side never saw, so it is a conflict (Skip by
      // default), and a schedule on it blocks it.
      const attention: PlanAttention = !match
        ? null
        : match.scheduled
          ? 'scheduled'
          : 'conflict'
      built.push(
        entryBuilt(dev, match, {
          kind: 'entry.change',
          attention,
          productionChanged: match !== undefined,
          collectionLabel: undefined,
          preservedFields: [],
        }),
      )
      continue
    }
    const collectionExists =
      input.production.collections.some(
        (def) => def.key === dev.collectionKey,
      ) || addedKeys.has(dev.collectionKey)
    if (!collectionExists) continue
    built.push(
      entryBuilt(dev, undefined, {
        kind: 'entry.new',
        attention: null,
        productionChanged: false,
        collectionLabel: entryCollectionLabel(input, dev),
        preservedFields: [],
      }),
    )
  }
  return built
}

function entryBuilt(
  dev: PlanEntry,
  prod: PlanProductionEntry | undefined,
  options: {
    kind: PlanItemKind
    attention: PlanAttention
    productionChanged: boolean
    collectionLabel: string | undefined
    preservedFields: string[]
  },
): Built {
  const preserved = options.preservedFields
  const summary = entrySummary(dev, preserved)
  const item: PlanItem = {
    id: `entry:${dev.id}`,
    kind: options.kind,
    title: dev.title,
    ...(options.collectionLabel !== undefined
      ? { collectionLabel: options.collectionLabel }
      : {}),
    collectionKey: dev.collectionKey,
    devId: dev.id,
    summary:
      preserved.length > 0
        ? { ...summary, preservedFields: preserved }
        : summary,
    devChanged: true,
    productionChanged: options.productionChanged,
    attention: options.attention,
  }
  if (prod) {
    item.productionId = prod.id
    item.productionContentVersion = prod.contentVersion
  }
  if (preserved.length > 0) {
    item.dependsOn = [`schema:${dev.collectionKey}`]
  }
  return {
    item,
    fingerprint: { ...entryFingerprint(dev, prod), preserved },
  }
}

/**
 * Flags the entries a push would write under a URL that another entry holds:
 * a production entry of the same collection (other than the item's own target),
 * or another entry this plan writes. Apply is then disabled, so the URL must
 * change in development. Changes `built` in place.
 */
function annotateSlugCollisions(input: PlanInput, built: Built[]) {
  const devById = new Map(input.devEntries.map((row) => [row.id, row]))
  const writes = built.flatMap(({ item }) => {
    if (item.kind !== 'entry.new' && item.kind !== 'entry.change') return []
    const dev = item.devId ? devById.get(item.devId) : undefined
    return dev ? [{ item, dev }] : []
  })
  for (const write of writes) {
    const { item, dev } = write
    const production: SlugOwner[] = input.productionEntries
      .filter(
        (row) =>
          row.collectionKey === item.collectionKey &&
          row.id !== item.productionId,
      )
      .map((row) => ({
        id: row.id,
        title: row.title ?? row.slug,
        slug: row.slug,
        draftData: row.draftData ?? {},
      }))
    const pushed: SlugOwner[] = writes
      .filter(
        (other) =>
          other !== write && other.item.collectionKey === item.collectionKey,
      )
      .map((other) => ({
        id: other.item.id,
        title: other.item.title,
        slug: other.dev.slug,
        draftData: other.dev.draftData,
      }))
    const collisions = findSlugCollisions(
      { slug: dev.slug, draftData: dev.draftData },
      [...production, ...pushed],
    )
    if (collisions.length === 0) continue
    item.summary = { ...item.summary, slugCollisions: collisions }
    // A scheduled production entry stays the reason: it is resolved first.
    if (item.attention !== 'scheduled') item.attention = 'slug-taken'
  }
}

/**
 * Everything changed in dev since the fork or the last push, with the
 * Needs-attention flags, and the hash a push must echo back. Items are in
 * schema, languages, entries order; each group sorted by id.
 */
export function buildPlan(input: PlanInput): Plan {
  const base = input.base ?? EMPTY_SCHEMA
  const schema = schemaItems(input, base)
  const addedKeys = new Set(
    schema
      .filter((entry) => entry.item.kind === 'schema.add')
      .map((entry) => entry.item.collectionKey ?? ''),
  )
  const languages = languageItem(input, base)
  const entries = entryItems(input, addedKeys, removedFieldKeys(input, schema))
  annotateSlugCollisions(input, entries)
  const built = [...schema, ...(languages ? [languages] : []), ...entries]
  const items = built.map((entry) => entry.item)
  const fingerprints = built
    .map(({ item, fingerprint }) => ({
      id: item.id,
      kind: item.kind,
      productionContentVersion: item.productionContentVersion ?? null,
      attention: item.attention,
      summary: item.summary,
      dependsOn: item.dependsOn ?? null,
      affectedEntries: item.affectedEntries ?? null,
      fingerprint,
    }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return { items, planHash: sha256(stableStringify(fingerprints)) }
}

/**
 * Items a push applies. Undecided Needs-attention items are skipped. `scheduled`
 * and `slug-taken` never apply: the production schedule or the URL must be
 * resolved first.
 */
export function selectPlanItems(
  items: PlanItem[],
  decisions: { exclude: string[]; apply: string[] },
): { selected: PlanItem[]; skipped: PlanItem[] } {
  const excluded = new Set(decisions.exclude)
  const applied = new Set(decisions.apply)
  const selected: PlanItem[] = []
  const skipped: PlanItem[] = []
  for (const item of items) {
    const take =
      !excluded.has(item.id) &&
      (item.attention === null ||
        (!NEVER_APPLIED_ATTENTION.has(item.attention) && applied.has(item.id)))
    ;(take ? selected : skipped).push(item)
  }
  return { selected, skipped }
}

/**
 * Production changes since the baseline, whatever the dev env holds: schema
 * keys and languages that differ from the baseline, and forked entries whose
 * production `content_version` moved or whose row is gone, and production
 * entries a reset would copy that no dev entry is linked to. Drives the
 * "Production changed since the last sync" notice.
 */
export function productionChangeCount(input: PlanInput): number {
  const base = input.base ?? EMPTY_SCHEMA
  const keys = uniqueSorted([
    ...base.collections.map((def) => def.key),
    ...input.production.collections.map((def) => def.key),
  ])
  let count = 0
  for (const key of keys) {
    const b = findByKey(base.collections, key)
    const p = productionSide(
      findByKey(input.production.collections, key),
      b === undefined,
    )
    if (!deepEqual(b, p)) count += 1
  }
  if (!deepEqual(base.languages, input.production.languages)) count += 1
  const productionById = new Map(
    input.productionEntries.map((row) => [row.id, row]),
  )
  const linked = new Set<string>()
  for (const dev of input.devEntries) {
    if (dev.originEntryId == null) continue
    linked.add(dev.originEntryId)
    const prod = productionById.get(dev.originEntryId)
    if (!prod || prod.contentVersion !== dev.originContentVersion) count += 1
  }
  // A production entry a reset would copy (fork rules: ready and not archived,
  // or any section) that no dev entry is linked to is a change too: a new one,
  // or a ready one. Collections dev lacks count as well, since a reset copies
  // them; the schema count also lists them, so one collection can count twice.
  const devKeys = new Set(input.dev.collections.map((def) => def.key))
  const baseKeys = new Set(base.collections.map((def) => def.key))
  for (const row of input.productionEntries) {
    if (linked.has(row.id)) continue
    // A disabled production collection that dev and the baseline both lack was
    // removal-pushed: it counts as absent (see productionSide).
    const absent =
      !devKeys.has(row.collectionKey) &&
      !baseKeys.has(row.collectionKey) &&
      findByKey(input.production.collections, row.collectionKey)?.enabled ===
        false
    if (absent) continue
    const forkable =
      row.collectionKind === 'global' ||
      (row.status !== 'archived' && row.publishedData != null)
    if (forkable) count += 1
  }
  return count
}

/**
 * Whether each collection or section matches production exactly: same key and
 * kind, and the same definition down to every field. A copy to production is
 * refused for a collection that does not match ("Push the schema first.").
 */
export function collectionsMatchProduction(
  input: Pick<PlanInput, 'dev' | 'production'>,
): Record<string, boolean> {
  const keys = uniqueSorted([
    ...input.dev.collections.map((def) => def.key),
    ...input.production.collections.map((def) => def.key),
  ])
  const matches: Record<string, boolean> = {}
  for (const key of keys) {
    const d = findByKey(input.dev.collections, key)
    matches[key] = deepEqual(
      d,
      productionSide(findByKey(input.production.collections, key), !d),
    )
  }
  return matches
}
